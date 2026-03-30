declare module "*.png" {
  import { StaticImageData } from "next/image";
  const content: StaticImageData;
  export default content;
}

declare module "*.jpg" {
  import { StaticImageData } from "next/image";
  const content: StaticImageData;
  export default content;
}

declare module "*.jpeg" {
  import { StaticImageData } from "next/image";
  const content: StaticImageData;
  export default content;
}

declare module "*.svg" {
  import { FC, SVGProps } from "react";
  const content: FC<SVGProps<SVGSVGElement>>;
  export default content;
}
