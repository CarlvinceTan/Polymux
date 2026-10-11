package skills

import (
	"embed"
	"strings"
)

// IssueRepo is the target repo for user bug reports.
const IssueRepo = "CarlvinceTan/Polymux"

//go:embed help/SKILL.md
var files embed.FS

func Help() string {
	body, _ := files.ReadFile("help/SKILL.md")
	return strings.ReplaceAll(string(body), "{{REPO}}", IssueRepo)
}
