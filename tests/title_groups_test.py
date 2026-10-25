import copy
import json
import sys
import tempfile
import unittest
import argparse
import csv
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'library/tools'))
from title_groups import plan_groups, read_previous
from build_site import slugify, apply_overrides
import build_site


def row(identifier, **fields):
    return dict(id=identifier, name='Fictional Prey', year=2006,
                platforms=['Windows'], developers=['Original Studio'], steamAppId='', **fields)


def project(groups):
    return [dict(id=identifier, name=copies[0]['name'], groupingVersion=2,
                 groupingKey=key, copies=copies, legacyGroups=ancestors)
            for identifier, key, copies, ancestors in groups]


class TitleGroupTests(unittest.TestCase):
    def test_reboots_platforms_missing_facts_and_conflicting_products_stay_separate(self):
        base = row('original')
        variants = [dict(base, id='reboot', year=2017), dict(base, id='port', platforms=['PS4']),
                    dict(base, id='unknown-year', year=None), dict(base, id='unknown-dev', developers=[]),
                    dict(base, id='unknown-platform', platforms=[]), dict(base, id='other-dev', developers=['Other Studio']),
                    dict(base, id='product-a', steamAppId='100'), dict(base, id='product-b', steamAppId='200'),
                    dict(base, id='edition', name='Fictional Prey Remastered')]
        groups = project(plan_groups([base, *variants], [], slugify))
        self.assertEqual(len(groups), 10)
        self.assertEqual(len({g['id'] for g in groups}), 10)
        self.assertTrue(all(len(g['copies']) == 1 for g in groups))

    def test_same_release_metadata_groups_copies_but_never_erases_copy_ids(self):
        rows = [row('steam'), row('gog')]
        groups = project(plan_groups(rows, [], slugify))
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['id'], 'fictional-prey')
        self.assertEqual({c['id'] for c in groups[0]['copies']}, {'steam', 'gog'})
        self.assertEqual(project(plan_groups(list(reversed(rows)), groups, slugify)), groups)

    def test_split_preserves_legacy_scope_and_survives_reimports_and_missing_copy(self):
        rows = [row('original'), dict(row('reboot'), year=2017)]
        old = [dict(id='fictional-prey', name='Fictional Prey', copies=rows,
                    notes='Which version did I mean?', favorite=True, hidden=True)]
        untouched = copy.deepcopy(old)
        groups = project(plan_groups(rows, old, slugify))
        self.assertEqual(old, untouched)
        self.assertEqual(len(groups), 2)
        for g in groups:
            self.assertNotEqual(g['id'], old[0]['id'])
            self.assertEqual(g['legacyGroups'][0]['notes'], old[0]['notes'])
            self.assertEqual(g['legacyGroups'][0]['copyIds'], ['original', 'reboot'])
        again = project(plan_groups(list(reversed(rows)), groups, slugify))
        self.assertEqual({g['copies'][0]['id']:g for g in groups}, {g['copies'][0]['id']:g for g in again})
        remaining = project(plan_groups(rows[:1], again, slugify))
        self.assertEqual(remaining[0], groups[0])
        edited = apply_overrides(groups, {'fictional-prey': {'notes':'Edited old note','favorite':True,'hidden':True}})
        self.assertTrue(all(g['notes'] == '' and not g['favorite'] for g in edited))
        self.assertTrue(all(g['legacyGroups'][0]['notes'] == 'Edited old note' for g in edited))

    def test_corrected_identity_creates_scope_and_membership_changes_preserve_notes(self):
        rows = [row('a'), row('b')]
        previous = project(plan_groups(rows, [], slugify))
        previous[0]['notes'] = 'Both copies'
        partial = project(plan_groups(rows[:1], previous, slugify))
        self.assertNotEqual(partial[0]['id'], previous[0]['id'])
        self.assertEqual(partial[0]['legacyGroups'][0]['notes'], 'Both copies')
        renamed = project(plan_groups([dict(rows[0], name='Corrected title')], partial, slugify))
        self.assertNotEqual(renamed[0]['id'], partial[0]['id'])
        self.assertIn('fictional-prey', [g['id'] for g in renamed[0]['legacyGroups']])

    def test_old_slug_collisions_stay_with_original_copy_membership(self):
        rows = [dict(row('a'), name='A+B'), dict(row('b'), name='A B')]
        previous = [dict(id='a-b',name='A+B',copies=[rows[0]]),dict(id='a-b-2',name='A B',copies=[rows[1]])]
        groups = project(plan_groups(list(reversed(rows)), previous, slugify))
        self.assertEqual({g['copies'][0]['id']:g['id'] for g in groups}, {'a':'a-b','b':'a-b-2'})

    def test_previous_snapshot_is_parsed_as_data_and_corruption_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'snapshot.js'
            self.assertEqual(read_previous(path), [])
            value = [dict(id='old', name='Old', copies=[row('a')])]
            path.write_text('window.PLAYNITE_LIBRARY = '+json.dumps(value)+';\nwindow.PLAYNITE_STATS = {};')
            self.assertEqual(read_previous(path), value)
            for source in ['window.PLAYNITE_LIBRARY = runCode();', 'window.PLAYNITE_LIBRARY = [',
                           'window.PLAYNITE_LIBRARY = '+json.dumps(value+value)+';']:
                path.write_text(source)
                with self.assertRaisesRegex(ValueError, 'snapshot was kept'):
                    read_previous(path)
                self.assertEqual(path.read_text(), source)

    def test_full_csv_rebuild_retains_recovery_copy_and_lineage_without_private_caches(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            output, source = root / 'library-data.js', root / 'library.csv'
            original = 'window.PLAYNITE_LIBRARY = '+json.dumps([dict(id='same',name='Same',copies=[{'id':'a'},{'id':'b'}],notes='Old notes')])+';'
            output.write_text(original)
            with source.open('w', newline='') as handle:
                writer=csv.DictWriter(handle,fieldnames=['Id','Name','Platforms','Sources','Release Date','Developers'])
                writer.writeheader()
                writer.writerows([dict(Id='a',Name='Same',Platforms='PC',Sources='Local',**{'Release Date':'2006-01-01','Developers':'Studio'}),
                                 dict(Id='b',Name='Same',Platforms='PC',Sources='Local',**{'Release Date':'2017-01-01','Developers':'Studio'})])
            args=argparse.Namespace(csv=source,out=output,previous=None,backup_root=root/'absent')
            with patch.multiple(build_site,ROOT=root,OVERRIDES_PATH=root/'no-overrides',parse_args=lambda:args), patch.multiple(build_site.steam_meta,load_igdb_genres=lambda:{},load_name_map=lambda:{},load_details_cache=lambda:{},load_wikidata_genres=lambda:{}):
                build_site.build()
                first=read_previous(output)
                self.assertEqual(len(first),2)
                self.assertEqual({c['id'] for g in first for c in g['copies']},{'a','b'})
                self.assertTrue(all(g['legacyGroups'][0]['notes']=='Old notes' for g in first))
                backups=list(root.glob('*.before-regrouping-*.js'))
                self.assertEqual(len(backups),1)
                self.assertEqual(backups[0].read_text(),original)
                build_site.build()
                self.assertEqual(read_previous(output),first)
                self.assertEqual(len(list(root.glob('*.before-regrouping-*.js'))),1)


if __name__ == '__main__':
    unittest.main()
