/*
 * [INPUT]: 依赖 esbuild transform 产物（纯 JS ESM）与 tdewolff/parse JS AST。
 * [OUTPUT]: 形状校验结果：default export 必须是定义对象（含 render）或函数/类组件。
 * [POS]: motion_graphic 构建层的「运行安全」闸；等价于原 component-build.js 的 runShapeCheck（TS 版），
 *        改为解析 esbuild 去类型后的 JS，因此不需要 Node/TypeScript。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import (
	"strings"

	"github.com/tdewolff/parse/v2"
	"github.com/tdewolff/parse/v2/js"
)

var componentSurfaces = map[string]bool{"html": true, "react": true, "r3f": true}

// shapeCheck 校验 transform 后的 JS：default export 是对象字面量时必须含函数 render，
// surface（若有）合法，getContentBounds（若有）是函数；函数/类组件直接放行。
func shapeCheck(code string) []string {
	ast, err := js.Parse(parse.NewInputBytes([]byte(code)), js.Options{})
	if err != nil {
		// 解析失败由 esbuild 编译阶段兜底；这里不额外判失败，避免误伤。
		return nil
	}
	vars := map[string]js.IExpr{}
	declared := map[string]bool{}
	var defaultExpr js.IExpr
	var defaultName string
	found := false
	for _, stmt := range ast.BlockStmt.List {
		switch s := stmt.(type) {
		case *js.VarDecl:
			for _, d := range s.List {
				if d.Default == nil {
					continue
				}
				if v, ok := d.Binding.(*js.Var); ok {
					vars[string(v.Data)] = d.Default
				}
			}
		case *js.FuncDecl:
			if s.Name != nil {
				declared[string(s.Name.Data)] = true
			}
		case *js.ClassDecl:
			if s.Name != nil {
				declared[string(s.Name.Data)] = true
			}
		case *js.ExportStmt:
			if s.Default {
				found = true
				defaultExpr = s.Decl
			}
			for _, alias := range s.List {
				if string(alias.Binding) == "default" {
					found = true
					defaultName = string(alias.Name)
				}
			}
		}
	}
	if !found {
		return []string{"缺少 default export：组件必须导出定义对象（含 render）或纯函数组件"}
	}
	if defaultExpr == nil && defaultName != "" {
		if decl, ok := vars[defaultName]; ok {
			defaultExpr = decl
		} else if declared[defaultName] {
			return nil
		}
	}
	if defaultExpr == nil {
		return []string{"缺少 default export：组件必须导出定义对象（含 render）或纯函数组件"}
	}
	return checkDefaultExpr(defaultExpr, vars)
}

func checkDefaultExpr(expr js.IExpr, vars map[string]js.IExpr) []string {
	switch value := expr.(type) {
	case *js.ObjectExpr:
		return checkObjectLiteral(value)
	case *js.ArrowFunc, *js.FuncDecl, *js.ClassDecl:
		return nil
	case *js.Var:
		// default export 指向一个标识符：解析到顶层声明；解析不出时放行（运行时仍有兜底校验）。
		if decl, ok := vars[string(value.Data)]; ok {
			return checkDefaultExpr(decl, vars)
		}
		return nil
	}
	return []string{"default export 必须是定义对象（含 render 方法）或纯函数组件"}
}

func checkObjectLiteral(object *js.ObjectExpr) []string {
	issues := []string{}
	var render, surface, bounds *js.Property
	for i := range object.List {
		property := &object.List[i]
		switch objectPropertyName(*property) {
		case "render":
			render = property
		case "surface":
			surface = property
		case "getContentBounds":
			bounds = property
		}
	}
	switch {
	case render == nil:
		issues = append(issues, "default 定义对象缺少 render 方法：组件无法渲染")
	case !isFunctionExpr(render):
		issues = append(issues, "default 定义对象的 render 必须是函数")
	}
	if surface != nil {
		if literal, ok := surface.Value.(*js.LiteralExpr); ok && literal.TokenType == js.StringToken {
			value := strings.Trim(string(literal.Data), `"'`)
			if !componentSurfaces[value] {
				issues = append(issues, "surface 非法: "+value+`（必须为 html/react/r3f）`)
			}
		}
	}
	if bounds != nil && !isFunctionExpr(bounds) {
		issues = append(issues, "getContentBounds 必须是函数")
	}
	return issues
}

func objectPropertyName(property js.Property) string {
	if property.Name != nil {
		return string(property.Name.Literal.Data)
	}
	// 方法简写（render(ctx) {}）在 AST 中 Name 为空，名字落在 MethodDecl.Name。
	if method, ok := property.Value.(*js.MethodDecl); ok {
		return string(method.Name.PropertyName.Literal.Data)
	}
	return ""
}

func isFunctionExpr(property *js.Property) bool {
	if _, ok := property.Value.(*js.ArrowFunc); ok {
		return true
	}
	if _, ok := property.Value.(*js.MethodDecl); ok {
		return true
	}
	if _, ok := property.Value.(*js.FuncDecl); ok {
		return true
	}
	if property.Init != nil {
		if _, ok := property.Init.(*js.ArrowFunc); ok {
			return true
		}
		if _, ok := property.Init.(*js.FuncDecl); ok {
			return true
		}
	}
	return false
}
