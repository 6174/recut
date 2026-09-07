# 渲染流程架构

## 渲染理念
1. 为了应对各种场景，采用 Adapter 的模式来实现各种情况的渲染
  - 元素多，元素交互简单，对操作要快速响应的场景，可以使用 canvas 底层 adapter，比如 pixi.js， antv 的 G 
  - 元素少，扩展性要求高，这种场景用 DOM 就能很快解决，比如 Canva 场景的海报编辑，一个画布中元素就几个
  - 3D 元素场景，使用 Three.js 渲染
  - 未来如果要实现 Figma 级别的编辑器，可能要用 C++ 或者 Rust 来自己定义底层渲染框架，框架层和渲染底层的交互接口就是一个 render-object-list
2. 整个编辑器层所做的事情
  - 托管 Block 的渲染周期，做简单高效的精细化渲染控制
    - Block 增删改查后的渲染更新
  - 提供控制层，支持 Plugin 模式，编辑器其实分为两层
    - 渲染底层：本质只负责渲染和元素事件传递（其实也可以上层托管，但元素级别的事件其实各个渲染底层自身都已经实现了）
    - 控制层：工具栏，框选框，文本编辑框，画笔等本质都是上层的交互组件，这些组件要有方式能够扩展
  - 提供数据状态管理层：
    - 基于 YJS 来实现数据管理
    - 数据结构就是 BlockTree
    - 提供 Block 的本地临时数据管理和同步数据管理，undo,redo 等方法
    - 提供 Block 的通用数据管理操作方法（位置，旋转，父子关系等）

# 一些基础概念定义

- Block：编辑器的基础渲染粒度，Block 的关系是一个 tree 结构，所以行为都是围绕 Block 展开
- EditorState: 数据层获取所有 Block 数据
  - BlockRecord: Block 对应的数据
  - 通过 state.transact 方法来更新
- Plugin：Plugin 可以扩展编辑器控制层
- Renderer： 
  - RenderAdapter
  - Element：Block 的渲染是由 Element 组成，Element 是一个抽象类，但具体是什么通过 RenderAdapter 来决定
  - 渲染依赖更新
- Editor: 对外提供的 Editor 封装

# 怎样实现一个编辑器
- 选择 render-adapter，从提供的多种渲染器中选择一个
- 定义 Plugin，其中包含了 Block 的定义，编辑器行为的扩展
- 选择默认提供的各种 Plugin 扩展，根据自己的需求来扩展
