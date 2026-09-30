// Post-processing passes for Game's composer: the soft-knee bloom and an output pass that adds the bloom while it
// tone maps, so the bloom never has to be blended back into the (multisampled) HDR frame target.
//
// Frame (Game.render): world RenderPass -> viewmodel RenderPass (clears depth) -> KineticBloomPass (optional)
//   -> KineticOutputPass (+ bloom, exposure, ACES tone mapping, sRGB) -> canvas.

import { RawShaderMaterial, ColorManagement, SRGBTransfer, ACESFilmicToneMapping, LinearToneMapping, ReinhardToneMapping,
  CineonToneMapping, AgXToneMapping, NeutralToneMapping } from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputShader } from 'three/addons/shaders/OutputShader.js';

// Replaces the stock high-pass (a hard luminance step that hands the *whole* colour of every bright pixel to the
// blur, so big bright areas - a lit wall, an explosion - bloom into a screen-wide veil). This one feeds the blur only
// the energy ABOVE the threshold (soft quadratic knee, width = smoothWidth), measures brightness by the strongest
// channel as well as luminance (saturated neon has a low luminance) and caps a single pixel at 1.8 so a sun disc /
// muzzle flash / fireball (HDR 5+) cannot spray a screen-sized halo.
const HIGH_PASS_FRAG = `
  uniform sampler2D tDiffuse;
  uniform vec3 defaultColor;
  uniform float defaultOpacity;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  varying vec2 vUv;
  void main() {
    vec3 c = min( texture2D( tDiffuse, vUv ).rgb, vec3( 1.8 ) );
    float v = max( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.7 * max( c.r, max( c.g, c.b ) ) );
    float knee = max( smoothWidth, 0.001 );
    float soft = clamp( v - luminosityThreshold + knee, 0.0, 2.0 * knee );
    soft = soft * soft / ( 4.0 * knee );
    float w = max( soft, v - luminosityThreshold ) / max( v, 0.0001 );
    gl_FragColor = vec4( c * w, 1.0 );
  }`;

// Composite: the stock one adds the five blur levels with weights summing to ~3 and then multiplies the result by
// its own alpha again (so bloom energy grows with strength^2 and a uniformly bright frame is amplified several
// times over - the whiteout when an explosion lights the whole screen). Here strength is linear, the mip weights
// are normalised (strength 1 = the bloom input is added back once) and a veiling-glare limiter backs the bloom
// off when a large part of the frame is feeding it. That frame average (9 taps of the smallest blur level) is the
// same for every pixel, so the vertex shader computes it once per quad corner instead of the fragment shader per pixel.
const COMPOSITE_VERT = `
  varying vec2 vUv;
  varying float vAvg;
  uniform sampler2D blurTexture5;
  void main() {
    vUv = uv;
    vec3 v = vec3( 0.0 );
    for ( int i = 0; i < 3; i ++ ) {
      for ( int j = 0; j < 3; j ++ ) v += texture2D( blurTexture5, ( vec2( float( i ), float( j ) ) + 0.5 ) / 3.0 ).rgb;
    }
    vAvg = dot( v / 9.0, vec3( 0.2126, 0.7152, 0.0722 ) );
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`;

const COMPOSITE_FRAG = `
  varying vec2 vUv;
  varying float vAvg;
  uniform sampler2D blurTexture1;
  uniform sampler2D blurTexture2;
  uniform sampler2D blurTexture3;
  uniform sampler2D blurTexture4;
  uniform sampler2D blurTexture5;
  uniform float bloomStrength;
  uniform float bloomRadius;
  uniform float bloomFactors[NUM_MIPS];
  uniform vec3 bloomTintColors[NUM_MIPS];
  float lerpBloomFactor( const in float factor ) {
    return mix( factor, 1.2 - factor, bloomRadius );
  }
  void main() {
    float w0 = lerpBloomFactor( bloomFactors[0] );
    float w1 = lerpBloomFactor( bloomFactors[1] );
    float w2 = lerpBloomFactor( bloomFactors[2] );
    float w3 = lerpBloomFactor( bloomFactors[3] );
    float w4 = lerpBloomFactor( bloomFactors[4] );
    vec3 b = w0 * texture2D( blurTexture1, vUv ).rgb + w1 * texture2D( blurTexture2, vUv ).rgb
           + w2 * texture2D( blurTexture3, vUv ).rgb + w3 * texture2D( blurTexture4, vUv ).rgb
           + w4 * texture2D( blurTexture5, vUv ).rgb;
    b *= bloomStrength / ( w0 + w1 + w2 + w3 + w4 );
    gl_FragColor = vec4( b / ( 1.0 + 3.0 * vAvg ), 1.0 );
  }`;

/**
 * UnrealBloomPass with the soft-knee high pass and normalised composite above. It does not blend its result back
 * into the frame: the composite stays in `outputTexture` (half resolution) and KineticOutputPass adds it while tone
 * mapping (same sum, but no full-resolution additive pass into the multisampled target and no extra MSAA resolve).
 * Its blur targets have no depth buffers (fullscreen passes never depth test).
 */
export class KineticBloomPass extends UnrealBloomPass {
  /**
   * @param {number} width  drawing-buffer width in pixels
   * @param {number} height drawing-buffer height in pixels
   */
  constructor(width, height) {
    super({ x: width, y: height }, 0.45, 0.85, 0.7);
    for (const rt of [this.renderTargetBright, ...this.renderTargetsHorizontal, ...this.renderTargetsVertical]) rt.depthBuffer = false;
    const hp = this.materialHighPassFilter;
    hp.fragmentShader = HIGH_PASS_FRAG;
    hp.needsUpdate = true;
    this.compositeMaterial.vertexShader = COMPOSITE_VERT;
    this.compositeMaterial.fragmentShader = COMPOSITE_FRAG;
    this.compositeMaterial.needsUpdate = true;
    /** true: leave the composite in outputTexture for the output pass; false: stock additive blend into the frame. */
    this.fold = true;
  }

  /** The bloom composite of the last render (half resolution, linear HDR); add it to the frame before tone mapping. */
  get outputTexture() {
    return this.renderTargetsHorizontal[0].texture;
  }

  /** Free every GPU resource (three's UnrealBloomPass.dispose leaves the high-pass material's program alive). */
  dispose() {
    super.dispose();
    this.materialHighPassFilter.dispose();
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (!this.fold) {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    renderer.getClearColor(this._oldClearColor);
    this.oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    const quad = this.fsQuad;

    // 1. extract the energy above the threshold (half resolution)
    this.highPassUniforms.tDiffuse.value = readBuffer.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    quad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    quad.render(renderer);

    // 2. separable blur down the mip chain
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      quad.material = m;
      m.uniforms.colorTexture.value = input.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      quad.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      quad.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    // 3. composite the mips into renderTargetsHorizontal[0] (= outputTexture; its blur content is no longer needed)
    const cu = this.compositeMaterial.uniforms;
    quad.material = this.compositeMaterial;
    cu.bloomStrength.value = this.strength;
    cu.bloomRadius.value = this.radius;
    cu.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    quad.render(renderer);

    renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}

const OUTPUT_FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  #ifdef USE_BLOOM
  uniform sampler2D tBloom;
  #endif
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D( tDiffuse, vUv );
    #ifdef USE_BLOOM
    gl_FragColor.rgb += texture2D( tBloom, vUv ).rgb;
    #endif
    #ifdef LINEAR_TONE_MAPPING
    gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
    #elif defined( REINHARD_TONE_MAPPING )
    gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
    #elif defined( CINEON_TONE_MAPPING )
    gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
    #elif defined( ACES_FILMIC_TONE_MAPPING )
    gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
    #elif defined( AGX_TONE_MAPPING )
    gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
    #elif defined( NEUTRAL_TONE_MAPPING )
    gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
    #endif
    #ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF( gl_FragColor );
    #endif
  }`;

const TONE_DEFINES = new Map([
  [LinearToneMapping, 'LINEAR_TONE_MAPPING'], [ReinhardToneMapping, 'REINHARD_TONE_MAPPING'],
  [CineonToneMapping, 'CINEON_TONE_MAPPING'], [ACESFilmicToneMapping, 'ACES_FILMIC_TONE_MAPPING'],
  [AgXToneMapping, 'AGX_TONE_MAPPING'], [NeutralToneMapping, 'NEUTRAL_TONE_MAPPING'],
]);

/**
 * three's OutputPass (exposure, the renderer's tone mapping and output colour space) that also adds a bloom texture
 * before tone mapping. Set `bloomTexture` every frame (null = no bloom). With and without bloom are two materials
 * (two programs that both stay compiled), so switching bloom on or off never rebuilds a shader.
 * It never swaps the composer's buffers (it is always the last pass and writes to the canvas), so the frame stays in
 * the composer's readBuffer and the composer's second HDR target is never allocated.
 */
export class KineticOutputPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.uniforms = { tDiffuse: { value: null }, tBloom: { value: null }, toneMappingExposure: { value: 1 } };
    const make = name => new RawShaderMaterial({
      name, uniforms: this.uniforms, vertexShader: OutputShader.vertexShader, fragmentShader: OUTPUT_FRAG,
    });
    this.material = make('KineticOutput');
    this.bloomMaterial = make('KineticOutputBloom');
    this.fsQuad = new FullScreenQuad(this.material);
    /** @type {import('three').Texture|null} bloom to add this frame */
    this.bloomTexture = null;
    this._colorSpace = null;
    this._toneMapping = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tBloom.value = this.bloomTexture;
    u.toneMappingExposure.value = renderer.toneMappingExposure;
    if (this._colorSpace !== renderer.outputColorSpace || this._toneMapping !== renderer.toneMapping) {
      this._colorSpace = renderer.outputColorSpace;
      this._toneMapping = renderer.toneMapping;
      const d = {};
      if (ColorManagement.getTransfer(this._colorSpace) === SRGBTransfer) d.SRGB_TRANSFER = '';
      const tm = TONE_DEFINES.get(this._toneMapping);
      if (tm) d[tm] = '';
      this.material.defines = d;
      this.bloomMaterial.defines = { ...d, USE_BLOOM: '' };
      this.material.needsUpdate = true;
      this.bloomMaterial.needsUpdate = true;
    }
    this.fsQuad.material = this.bloomTexture ? this.bloomMaterial : this.material;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.bloomMaterial.dispose();
    this.fsQuad.dispose();
  }
}
