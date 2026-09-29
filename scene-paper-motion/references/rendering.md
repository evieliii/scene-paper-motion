# 参数与执行

先用依赖工具给出的 Node 和 node_modules，路径按 shell 引用为单个参数：

```text
node <skill>/scripts/render.cjs --plan <work>/plan.json --modules <node_modules> --preview
node <skill>/scripts/render.cjs --plan <work>/plan.json --modules <node_modules> --ffmpeg <ffmpeg>
```

不传 --ffmpeg 仍输出 PNG、GIF，MP4 不生成。无需安装 npm/pip。相对路径相对于 plan.json。

## plan.json

所有几何坐标为下方插画面板的 **0–1 归一化坐标**，查看本次插画后实测：

```json
{
  "photo": "photo-focus.png",
  "illustration": "illustration.png",
  "outputDir": "result",
  "name": "scene",
  "duration": 4,
  "fps": 24,
  "width": 900,
  "panelHeight": 600,
  "gifWidth": 720,
  "motions": [{
    "type": "drift",
    "rect": [0.08, 0.06, 0.88, 0.58],
    "displacement": [0.025, 0],
    "cycles": 1,
    "fadeY": false,
    "ceilingLine": [0.03, 0.51, 0.96, 0.58]
  }]
}
```

rect 为 [左,上,右,下]，motions 为 1–2 项；静态模式传空数组。cycles 是正整数，activeTime 可指定预览时刻。验证内置例图时，可用 referencePair（上下两面板 PNG）替代 photo/illustration；新主题须生成自己的素材。

## 动作

- drift：rect、displacement、cycles；外围平滑归零。ceilingLine 限制在线以上，屋脊固定。位移宽度的 2–3%。
- head-sway：rect、center、radius、pivot、angleDegrees（3–5）、displacement、cycles（常用 2）。可加 ears:[{center,radius,sign:1},...]、earAmplitude（面板高约 0.01）。头颈外围归零。
- flag-flutter：rect、cordLine、clothLength、amplitude、cycles。悬挂绳线固定，下缘摆动，避开屋顶和栅栏。
- light-pulse：rect、polygons:[[[x,y],...],...]、color:[r,g,b]、strength（0–1）、cycles。可加 maxLuminance 排除明亮框架。只选玻璃或灯体。
- wave-crest：rect、polygons 限定海水、path（M/C 命令）、displacement、color、lineWidth、cycles；blueWaterOnly:true 排除沙滩、树木。例 path:[["M",0.7,0.48],["C",0.6,0.49,0.5,0.49,0.49,0.53]]。
- exposure：rect、polygons（沿场景边界，避纸框）、nightGain（例 [0.06,0.065,0.075]）、nightLift（例 [6,7,10]）、cycles。只用于指定日落/入夜/明暗；不能替代移动光带。
- cutout-move：rect、sprite（透明 PNG）、start/end（中心）、spriteWidth、cycles。illustration 为移除物件的底图。occluders 多边形把底图建筑覆盖回物件前。仅物件溶回起点。

点用 [x,y]，线用 [x1,y1,x2,y2]。除 lineWidth（像素）、angleDegrees（角度）外，几何量归一化。rect 必须覆盖完整移动范围。

## 检查

输出 name.png、name.gif、可用时 name.mp4、motion-proof.png、verification.json。脚本检查原照固定、区域外固定和端点一致；仍需目视确认动物自然、遮挡正确、动作可见、循环无跳变。

FFmpeg 使用固定全局调色板。无 FFmpeg 时 Sharp 尽量复用调色板，查看实际 GIF 确认静止背景、纸框不闪。通过后停止重复测试。
