import { motion } from 'framer-motion';
import { useId } from 'react';

interface RootLogoProps {
  size?: number | string;
  className?: string;
  animated?: boolean;
  glowColor?: string;
  /** Use rich gradient + texture fill instead of flat currentColor */
  textured?: boolean;
}

/**
 * The r00t.fund organic root logo — an interconnected root system
 * representing regenerative finance. Renders with currentColor by default
 * so it inherits the green accent from parent context.
 *
 * Pass `textured` for the hero variant with gradient fill,
 * organic grain, and inner light effects.
 */
export function RootLogo({
  size = 120,
  className = '',
  animated = false,
  glowColor,
  textured = false,
}: RootLogoProps) {
  const uid = useId().replace(/:/g, '');

  const svgStyle = {
    width: typeof size === 'number' ? `${size}px` : size,
    height: typeof size === 'number' ? `${size}px` : size,
    ...(glowColor ? { filter: `drop-shadow(0 0 24px ${glowColor})` } : {}),
  };

  const pathD = `M212.521332,290.474915
    C216.026886,293.578308 219.322052,296.383972 222.522064,299.294250
    C246.724380,321.305176 240.959717,358.669464 210.941635,374.454926
    C184.330643,388.448761 150.493912,376.351196 139.356140,348.861145
    C132.007019,330.722229 137.307526,309.935028 153.288895,297.728394
    C170.754272,284.388275 178.548080,266.483978 179.853516,245.218597
    C180.271378,238.411499 180.149384,231.556915 179.979416,224.731400
    C179.704697,213.700165 172.631454,208.843750 162.525558,213.085983
    C146.624115,219.761078 134.772034,230.160370 130.069855,247.764099
    C126.775711,260.096527 115.278198,267.565643 103.298645,266.709991
    C90.673042,265.808197 80.772224,257.257599 78.395973,245.203415
    C74.986389,227.907440 90.072647,212.085281 108.328331,214.581711
    C124.465866,216.788483 139.076263,213.570160 152.659683,204.883270
    C153.640869,204.255783 154.628738,203.633926 155.570190,202.949844
    C164.245544,196.646042 163.920959,190.078781 154.402817,185.055939
    C137.097687,175.923828 119.010185,170.310944 99.227829,175.000275
    C91.991035,176.715714 85.091179,179.956177 77.819023,181.399536
    C55.177525,185.893356 31.899712,168.176132 29.194962,144.854752
    C26.514469,121.742516 44.553093,100.230537 67.714584,98.918144
    C88.774246,97.724846 105.761673,107.864021 111.662323,126.968140
    C117.885674,147.117020 131.128784,160.201843 149.427246,169.064240
    C154.202042,171.376785 159.109528,173.548019 164.161819,175.124847
    C172.451981,177.712204 178.290359,174.859848 179.237686,166.384857
    C181.245087,148.425873 182.133347,130.260727 170.344818,114.623222
    C167.072876,110.282974 163.200592,106.232811 159.000763,102.783806
    C144.013870,90.476219 138.468826,74.397957 143.906677,57.632801
    C149.524445,40.312874 165.616028,28.091072 183.953751,27.216412
    C207.676666,26.084894 226.928665,40.454231 231.303680,63.474380
    C234.074249,78.052315 228.982788,90.655457 217.674240,100.003166
    C206.274933,109.425880 196.693283,119.976334 194.869156,135.052124
    C193.619614,145.379181 193.787811,155.994949 194.494431,166.402039
    C194.999908,173.846878 201.256699,177.794769 208.152130,175.581558
    C226.552719,169.675583 243.316544,160.954590 254.171051,144.101913
    C257.272125,139.287231 259.372894,133.680283 261.141907,128.182297
    C267.417511,108.678108 284.018829,97.648224 305.785278,98.942902
    C324.215332,100.039116 340.923798,114.938301 343.780029,133.706451
    C346.135376,149.183456 341.224304,162.574829 328.886292,172.352875
    C316.618256,182.075439 302.077057,185.867691 287.615265,179.463058
    C264.337555,169.154144 242.768265,173.267792 221.384979,183.860229
    C209.065811,189.962646 208.936813,196.890152 220.388611,204.482590
    C234.036942,213.531326 248.822662,216.926697 265.099243,214.557739
    C276.897339,212.840607 287.793793,218.720581 292.972046,228.881821
    C297.972198,238.693588 296.626465,249.794830 288.758881,258.007843
    C281.872650,265.196381 273.243683,268.130188 263.297852,266.019073
    C252.893829,263.810699 245.825165,257.388519 243.248672,247.271866
    C238.614639,229.076233 225.831207,219.109482 209.658676,212.446274
    C202.248154,209.393051 195.445404,212.720963 194.667419,220.562256
    C192.436142,243.051636 192.932022,265.279205 207.353485,284.573975
    C208.843903,286.568024 210.622177,288.346893 212.521332,290.474915
  z`;

  // SVG defs for textured variant: gradient + organic grain + inner light
  const TextureDefs = () => (
    <defs>
      {/* Main gradient — deep forest to bright leaf */}
      <linearGradient id={`${uid}-grad`} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0%" stopColor="var(--accent-glow)" stopOpacity="1" />
        <stop offset="35%" stopColor="var(--accent)" stopOpacity="1" />
        <stop offset="70%" stopColor="var(--accent)" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#1a3a26" stopOpacity="1" />
      </linearGradient>

      {/* Dark-mode gradient — brighter range */}
      <linearGradient id={`${uid}-grad-dark`} x1="0.1" y1="0" x2="0.2" y2="1">
        <stop offset="0%" stopColor="#8EEAA0" stopOpacity="1" />
        <stop offset="30%" stopColor="var(--accent-glow)" stopOpacity="1" />
        <stop offset="65%" stopColor="var(--accent)" stopOpacity="1" />
        <stop offset="100%" stopColor="#2D5A3D" stopOpacity="1" />
      </linearGradient>

      {/* Organic noise texture */}
      <filter id={`${uid}-grain`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" stitchTiles="stitch" result="noise" />
        <feColorMatrix type="saturate" values="0" in="noise" result="gray" />
        <feBlend in="SourceGraphic" in2="gray" mode="soft-light" result="blend" />
        <feComposite in="blend" in2="SourceGraphic" operator="in" />
      </filter>

      {/* Inner light / bevel effect */}
      <filter id={`${uid}-bevel`} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
        <feSpecularLighting in="blur" surfaceScale="4" specularConstant="0.6" specularExponent="20" result="spec">
          <fePointLight x="120" y="60" z="200" />
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specClip" />
        <feComposite in="SourceGraphic" in2="specClip" operator="arithmetic" k1="0" k2="1" k3="0.4" k4="0" />
      </filter>
    </defs>
  );

  // Textured fill reference (picks light/dark via CSS)
  const texturedFill = `url(#${uid}-grad)`;
  const texturedFillDark = `url(#${uid}-grad-dark)`;
  const grainFilter = `url(#${uid}-grain)`;
  const bevelFilter = `url(#${uid}-bevel)`;

  if (animated && textured) {
    return (
      <motion.svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="60 20 250 380"
        style={svgStyle}
        className={className}
      >
        <TextureDefs />
        {/* Base layer with gradient */}
        <motion.path
          d={pathD}
          initial={{ pathLength: 0, fillOpacity: 0 }}
          animate={{ pathLength: 1, fillOpacity: 1 }}
          transition={{
            pathLength: { duration: 2.5, ease: 'easeInOut' },
            fillOpacity: { duration: 1, delay: 1.5 },
          }}
          stroke="var(--accent-glow)"
          strokeWidth={1.5}
          className="dark:hidden"
          fill={texturedFill}
          filter={bevelFilter}
        />
        <motion.path
          d={pathD}
          initial={{ pathLength: 0, fillOpacity: 0 }}
          animate={{ pathLength: 1, fillOpacity: 1 }}
          transition={{
            pathLength: { duration: 2.5, ease: 'easeInOut' },
            fillOpacity: { duration: 1, delay: 1.5 },
          }}
          stroke="var(--accent-glow)"
          strokeWidth={1.5}
          className="hidden dark:block"
          fill={texturedFillDark}
          filter={bevelFilter}
        />
        {/* Grain overlay clipped to path */}
        <path d={pathD} fill="currentColor" filter={grainFilter} opacity="0.15" />
      </motion.svg>
    );
  }

  if (animated) {
    return (
      <motion.svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="60 20 250 380"
        fill="currentColor"
        style={svgStyle}
        className={className}
      >
        <motion.path
          d={pathD}
          initial={{ pathLength: 0, fillOpacity: 0 }}
          animate={{ pathLength: 1, fillOpacity: 1 }}
          transition={{
            pathLength: { duration: 2.5, ease: 'easeInOut' },
            fillOpacity: { duration: 1, delay: 1.5 },
          }}
          stroke="currentColor"
          strokeWidth={1.5}
          fill="currentColor"
        />
      </motion.svg>
    );
  }

  if (textured) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="60 20 250 380" style={svgStyle} className={className}>
        <TextureDefs />
        <path d={pathD} className="dark:hidden" fill={texturedFill} filter={bevelFilter} />
        <path d={pathD} className="hidden dark:block" fill={texturedFillDark} filter={bevelFilter} />
        <path d={pathD} fill="currentColor" filter={grainFilter} opacity="0.15" />
      </svg>
    );
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="60 20 250 380" fill="currentColor" style={svgStyle} className={className}>
      <path d={pathD} />
    </svg>
  );
}

export default RootLogo;
