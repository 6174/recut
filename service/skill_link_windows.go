//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

// createSkillLink falls back to an NTFS junction via mklink /J because
// os.Symlink on Windows fails with ERROR_PRIVILEGE_NOT_HELD unless Developer
// Mode is enabled or the process is elevated. Junctions need no privilege and
// Go's os.Lstat reports them as symlinks, so recutSkillLinkStatus keeps working.
func createSkillLink(source, target string) error {
	output, err := exec.Command("cmd", "/c", "mklink", "/J", target, source).CombinedOutput()
	if err != nil {
		return fmt.Errorf("mklink /J: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
