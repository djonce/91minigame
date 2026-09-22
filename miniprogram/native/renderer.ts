import { copyPixels } from './session';

export type RendererKind = 'webgl' | '2d';
export interface Renderer { draw(frame: Uint32Array): void; close(): void }
type GL = WechatMiniprogram.CanvasRenderingContext.WebGLRenderingContext;
type Shader = WechatMiniprogram.CanvasRenderingContext.WebGLShader;

// JSNES packs 0x00BBGGRR. A little-endian byte view is already RGB; the shader
// supplies opaque alpha. No per-pixel JS conversion or new buffer each frame.
export class FrameBytes {
  private frame?: Uint32Array;
  private view?: Uint8Array;
  private converted?: Uint8ClampedArray;
  constructor(private littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1) {}
  get(frame: Uint32Array): Uint8Array {
    if (this.littleEndian) {
      if (frame !== this.frame) {
        this.frame = frame;
        this.view = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
      }
      return this.view!;
    }
    if (!this.converted) {
      this.converted = new Uint8ClampedArray(256 * 240 * 4);
      this.view = new Uint8Array(this.converted.buffer);
    }
    copyPixels(frame, this.converted);
    return this.view!;
  }
}

function webglRenderer(canvas: WechatMiniprogram.Canvas): Renderer {
  const gl: GL = canvas.getContext('webgl');
  if (!gl || typeof gl.createShader !== 'function') throw new Error('WebGL 不可用');
  const shaders: Shader[] = [];
  const program = gl.createProgram(), quad = gl.createBuffer(), texture = gl.createTexture();
  const close = () => {
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.deleteTexture(texture); gl.deleteBuffer(quad); gl.deleteProgram(program);
  };
  try {
    if (!program || !quad || !texture) throw new Error('无法分配 WebGL 资源');
    const shader = (type: number, source: string) => {
      const value = gl.createShader(type);
      if (!value) throw new Error('无法创建 WebGL 程序');
      shaders.push(value); gl.shaderSource(value, source); gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error('WebGL 程序编译失败');
      gl.attachShader(program, value);
    };
    shader(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 uv; void main(){ uv=vec2((position.x+1.0)*0.5,(1.0-position.y)*0.5); gl_Position=vec4(position,0.0,1.0); }');
    shader(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; uniform sampler2D screen; void main(){ gl_FragColor=vec4(texture2D(screen,uv).rgb,1.0); }');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL 程序连接失败');
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'screen'), 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 240, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, 256, 240); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const bytes = new FrameBytes();
    let draws = 0;
    return {
      draw(frame) {
        if (++draws % 60 === 0 && gl.isContextLost()) throw new Error('WebGL 上下文已失效');
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 240, gl.RGBA, gl.UNSIGNED_BYTE, bytes.get(frame));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      close,
    };
  } catch (error) { close(); throw error; }
}

export function createRenderer(canvas: WechatMiniprogram.Canvas, kind: RendererKind): Renderer {
  canvas.width = 256; canvas.height = 240;
  if (kind === 'webgl') return webglRenderer(canvas);
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(256, 240);
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#050806'; context.fillRect(0, 0, 256, 240);
  return { draw(frame) { copyPixels(frame, pixels.data); context.putImageData(pixels, 0, 0); }, close() {} };
}
