package portable

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"sort"
	"strings"
)

// A replacement unit is either one file or a directory containing exclusively
// manifest-owned program files. Mixed directories are split so unknown files,
// empty user directories and private state never enter the disposable backup.
type replacementUnit struct {
	name              string
	exists, next, dir bool
	files             int
}

type replacementNode struct {
	name                    string
	children                map[string]*replacementNode
	file, old, next, exists bool
	unknown                 bool
	files                   int
}

func replacementPlan(ctx context.Context, root *os.Root, previous, next Manifest, progress Reporter) ([]replacementUnit, error) {
	tree := &replacementNode{children: map[string]*replacementNode{}}
	add := func(name string, old bool) error {
		if !ValidPath(name) {
			return fmt.Errorf("无效的应用路径：%s", name)
		}
		n := tree
		parts := strings.Split(name, "/")
		for i, part := range parts {
			if n.file {
				return fmt.Errorf("应用文件与目录路径冲突：%s", name)
			}
			key := strings.ToLower(part)
			child := n.children[key]
			prefix := strings.Join(parts[:i+1], "/")
			if child == nil {
				child = &replacementNode{name: prefix, children: map[string]*replacementNode{}}
				n.children[key] = child
			} else if child.name != prefix {
				return errors.New("新旧应用路径大小写冲突")
			}
			n = child
		}
		if len(n.children) != 0 {
			return fmt.Errorf("应用文件与目录路径冲突：%s", name)
		}
		n.file = true
		if old {
			n.old = true
		} else {
			n.next = true
		}
		return nil
	}
	for _, m := range []struct {
		manifest Manifest
		old      bool
	}{{previous, true}, {next, false}} {
		for _, f := range m.manifest.Files {
			if err := add(f.Path, m.old); err != nil {
				return nil, err
			}
		}
		if err := add("RELEASE-MANIFEST.json", m.old); err != nil {
			return nil, err
		}
	}
	var count func(*replacementNode) int
	count = func(n *replacementNode) int {
		if n.file {
			n.files = 1
		} else {
			for _, child := range n.children {
				n.files += count(child)
				n.next = n.next || child.next
			}
		}
		return n.files
	}
	count(tree)
	done, last := 0, -1
	notify := func() {
		percent := 70 + 10*done/tree.files
		if percent != last {
			report(progress, percent, fmt.Sprintf("正在检查现有应用文件… %d/%d", done, tree.files))
			last = percent
		}
	}
	var scan func(*replacementNode) error
	scan = func(n *replacementNode) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		dir := n.name
		if dir == "" {
			dir = "."
		}
		f, err := root.Open(dir)
		if err != nil {
			return err
		}
		entries, readErr := f.ReadDir(-1)
		err = errors.Join(readErr, f.Close())
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := ctx.Err(); err != nil {
				return err
			}
			child := n.children[strings.ToLower(entry.Name())]
			if child == nil {
				n.unknown = true
				continue
			}
			child.exists = true
			if child.file {
				if !entry.Type().IsRegular() {
					return fmt.Errorf("安装路径包含链接或非文件：%s", child.name)
				}
				if !privatePath(child.name) && !child.old {
					return fmt.Errorf("存在不属于旧版应用的同名文件，请另选目录：%s", child.name)
				}
			} else if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("安装路径包含链接或非目录：%s", child.name)
			}
		}
		for _, child := range sortedReplacementChildren(n) {
			if child.file || !child.exists {
				done += child.files
				notify()
			} else if err := scan(child); err != nil {
				return err
			}
			n.unknown = n.unknown || child.unknown
		}
		return nil
	}
	notify()
	if err := scan(tree); err != nil {
		return nil, err
	}
	var units []replacementUnit
	var collect func(*replacementNode)
	collect = func(n *replacementNode) {
		if n.file {
			if privatePath(n.name) && n.exists || !n.exists && !n.next {
				return
			}
		} else if n.name == "" || n.unknown || privatePath(n.name) {
			for _, child := range sortedReplacementChildren(n) {
				collect(child)
			}
			return
		}
		if n.exists || n.next {
			units = append(units, replacementUnit{n.name, n.exists, n.next, !n.file, n.files})
		}
	}
	collect(tree)
	return units, nil
}

func sortedReplacementChildren(n *replacementNode) []*replacementNode {
	children := make([]*replacementNode, 0, len(n.children))
	for _, child := range n.children {
		children = append(children, child)
	}
	sort.Slice(children, func(i, j int) bool { return path.Base(children[i].name) < path.Base(children[j].name) })
	return children
}
