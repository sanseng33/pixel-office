declare module 'three/examples/jsm/postprocessing/EffectComposer.js' {
  import type { WebGLRenderer } from 'three';
  export class EffectComposer {
    constructor(renderer: WebGLRenderer);
    addPass(pass: unknown): void;
    setSize(width: number, height: number): void;
    render(): void;
  }
}

declare module 'three/examples/jsm/postprocessing/RenderPixelatedPass.js' {
  import type { Camera, Scene } from 'three';
  export class RenderPixelatedPass {
    constructor(pixelSize: number, scene: Scene, camera: Camera);
    normalEdgeStrength: number;
    depthEdgeStrength: number;
    setPixelSize(pixelSize: number): void;
  }
}

declare module 'three/examples/jsm/utils/BufferGeometryUtils.js' {
  import type { BufferGeometry } from 'three';
  export function mergeGeometries(geometries: BufferGeometry[], useGroups?: boolean): BufferGeometry;
}
