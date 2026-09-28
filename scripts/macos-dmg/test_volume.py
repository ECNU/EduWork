import plistlib
import subprocess
import unittest
from unittest.mock import patch

import volume


def result(code=0, data=None):
    return subprocess.CompletedProcess(['hdiutil'], code,
                                       plistlib.dumps(data) if data is not None else b'', b'busy')


class VolumeTest(unittest.TestCase):
    def test_attach_returns_whole_disk_for_readonly_image(self):
        info = {'system-entities': [{'dev-entry': '/dev/disk9'},
                                   {'dev-entry': '/dev/disk9s2', 'mount-point': '/tmp/volume'}]}
        with patch.object(volume.subprocess, 'run', return_value=result(data=info)) as run:
            self.assertEqual(volume.attach_image('/tmp/image.dmg', '/tmp/volume', True), '/dev/disk9')
        self.assertIn('-readonly', run.call_args.args[0])

    def test_busy_device_is_retried_without_forcing_eject(self):
        info = {'images': [{'system-entities': [{'dev-entry': '/dev/disk9'}]}]}
        with patch.object(volume.subprocess, 'run', side_effect=[result(16), result(data=info), result()]) as run, \
                patch.object(volume.time, 'sleep'):
            volume.detach_image('/dev/disk9')
        self.assertEqual([call.args[0] for call in run.call_args_list],
                         [['hdiutil', 'detach', '/dev/disk9'], ['hdiutil', 'info', '-plist'],
                          ['hdiutil', 'detach', '/dev/disk9']])

    def test_error_after_device_disappeared_counts_as_detached(self):
        with patch.object(volume.subprocess, 'run', side_effect=[result(16), result(data={'images': []})]):
            volume.detach_image('/dev/disk9')

    def test_busy_device_eventually_fails_so_caller_preserves_workspace(self):
        info = {'images': [{'system-entities': [{'dev-entry': '/dev/disk9'}]}]}
        with patch.object(volume.subprocess, 'run', side_effect=[result(16), result(data=info)] * 2), \
                patch.object(volume.time, 'sleep'):
            with self.assertRaises(subprocess.CalledProcessError):
                volume.detach_image('/dev/disk9', attempts=2)

    def test_unreadable_mount_inventory_is_not_treated_as_detached(self):
        with patch.object(volume.subprocess, 'run', side_effect=[result(16), result(data={})]):
            with self.assertRaises(KeyError):
                volume.detach_image('/dev/disk9')


if __name__ == '__main__':
    unittest.main()
