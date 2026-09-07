import { PomeloBlockProps } from "../../../pomelo-core";

export type AIImageBlockType = "AIImageBlock";

export enum AIImageOperationType {
  Upscale = "Upscale",
  Inpaint = "Inpaint",
  Variation = "Variation",
  RemoveBackground = "RemoveBackground",
  RemoveObject = "RemoveObject",
  TextToImage = "TextToImage",
  Outpaint = "Outpaint",
}

export type AIImageOperation = {
  id: string;
  type: AIImageOperationType;
  created_at: number;
  // 输入图片 src 或者 base64
  source: string;
  // 输入参数
  inputs: {
    [key: string]: string;
  };
  // 输出图片地址或者 base64
  outputs: {
    [key: string]: string;
  };
}

export type AIImageBlockProps = {
  src: string;
  // 遮罩图片 in base64
  mask?: string;
  operations?: AIImageOperation[];
} & PomeloBlockProps
