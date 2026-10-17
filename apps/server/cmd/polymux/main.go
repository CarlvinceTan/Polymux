package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "polymux: "+err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" {
		fmt.Println("usage: polymux serve [server flags] | pair [--url URL] [--no-qr] | export FILE | import FILE [--force] | version")
		return nil
	}
	if args[0] == "version" {
		fmt.Println("polymux")
		return nil
	}
	if args[0] == "pair" {
		return pair(args[1:])
	}
	if args[0] == "export" || args[0] == "import" {
		if len(args) < 2 {
			return fmt.Errorf("usage: polymux %s FILE [--force]", args[0])
		}
		force := len(args) > 2 && args[2] == "--force"
		if args[0] == "export" {
			return exportData(args[1])
		}
		return importData(args[1], force)
	}
	if args[0] != "serve" && args[0] != "server" {
		return fmt.Errorf("unknown command %q", args[0])
	}
	binary := "polymux-server"
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	target := filepath.Join(filepath.Dir(exe), binary)
	if _, err := os.Stat(target); err != nil {
		return fmt.Errorf("%s is not installed next to polymux", binary)
	}
	command := exec.Command(target, args[1:]...)
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	return command.Run()
}
