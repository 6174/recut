//go:build !windows

package main

import "os"

// createSkillLink links the skill source directory at target. Skill targets are
// directories, so Windows falls back to an NTFS junction (no admin/Developer
// Mode needed); every other platform uses a plain symlink.
func createSkillLink(source, target string) error {
	return os.Symlink(source, target)
}
