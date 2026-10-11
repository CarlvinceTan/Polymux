package skills

import (
	"io/fs"
	"reflect"
	"strings"
	"testing"
)

func TestHelp(t *testing.T) {
	body := Help()
	if !strings.Contains(body, IssueRepo) || strings.Contains(body, "{{REPO}}") {
		t.Fatal("help must substitute the issue repository")
	}
	if !strings.Contains(body, "explicit confirmation in chat") {
		t.Fatal("help must require confirmation before filing")
	}
	if !strings.Contains(body, "[REDACTED]") {
		t.Fatal("help must include the redaction marker")
	}
}

func TestFiles(t *testing.T) {
	var paths []string
	err := fs.WalkDir(files, ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		paths = append(paths, path)
		body, err := files.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(body), "issue-loop") {
			t.Errorf("developer skill embedded in %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(paths, []string{"help/SKILL.md"}) {
		t.Fatalf("embedded files = %v, want only help/SKILL.md", paths)
	}
}
