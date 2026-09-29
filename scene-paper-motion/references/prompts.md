# 提示词

## 主题先生成摄影图

具体化为自然生活瞬间，选择清楚可见的锚点，不加与主题无关的物件。

```text
Create one natural documentary photograph of [具体主题场景].
Landscape 3:2. [主体、视角、光线].
The focal point is [锚点], clearly visible with room for restrained later motion.
Believable photographic texture and a quiet everyday travel/life atmosphere.
No paper frame, illustration, collage, typography, graphics, multiple panels or motion blur.
```

此步不传插画作为摄影风格参考。生成图不描述成实拍；特定人物和实景身份以用户照片为准。

## 同场景插画

内容参考在前，风格参考在后；方括号按原照填写。

```text
Create ONE landscape 3:2 paper illustration faithfully based on image 1.
Image 1 is content. Image 2 is ONLY the visual style.
Preserve [主体数量、姿态、视角、位置、层次和遮挡].
Make [锚点] readable, naturally proportioned and separable.
Match muted flat gouache/cut-paper shapes, opaque layers, fixed soft grain,
warm ivory fibrous paper and irregular handmade edges.
Simplify [重复细节] but retain this scene's identity.
Use [照片提炼的主色] with warm cream paper margins.
One contained handmade rectangular vignette; output ONLY the illustration asset.
No photo comparison, typography, arrows, new subjects, decorative symbols, motion marks,
camera effects, photorealistic painting, watercolor wash or glossy 3D cartoon shading.
```

imagegen 生成静态素材，后续脚本负责 GIF，静态图不可称为动图。

## 分层时

- 干净底图：编辑已有插画，只移除活动物件、补足同材质背景，保持其他构图。
- 透明物件：参考已有插画只提取该物件，保持形状、颜色和姿态，transparent_background: true。

查看真实 alpha，对齐后用 cutout-move。轻摆头、彩旗、窗光通常不必多层。
