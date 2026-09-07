/**
 * 测量图片尺寸
 * @param imageSrc 图片的 src
 * @returns 图片的尺寸
 */
export async function measureImageSize(imageSrc: string) {
  const image = new Image();
  image.src = imageSrc;
  await image.decode();
  return {
    width: image.width,
    height: image.height
  }
}