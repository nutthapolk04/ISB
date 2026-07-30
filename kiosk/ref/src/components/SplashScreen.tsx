import { useEffect, useState } from "react";
import svgPaths from "@/imports/IsbSvg-1/svg-x4usi8idgl";
import newBPaths from "@/imports/Vector/svg-9rlbo7t4oe";

// ISB "I": p3cd58200 | ISB "S": pd6cc600 | ISB "B": newBPaths.p3420f200 (new import)
// Triangles: inline + mask paths
// Subtitle: all remaining letter paths

const SUBTITLE_PATHS = [
  svgPaths.p14e0c600, svgPaths.p1c8f6500, svgPaths.p1deb4780,
  svgPaths.p35c0d80, svgPaths.p353ff280, svgPaths.p2dcd3980,
  svgPaths.p25a76a00, svgPaths.p16cbf500, svgPaths.p18cf3800,
  svgPaths.p19504a00, svgPaths.p231cc0c0, svgPaths.p6e2da00,
  svgPaths.p8993700, svgPaths.p1557ad00, svgPaths.p26c05380,
  svgPaths.p21226600, svgPaths.p2258fcf0, svgPaths.p5222c0,
  svgPaths.p27e73380, svgPaths.p24993e80, svgPaths.p22d94580,
  svgPaths.p2df62200, svgPaths.p2236b8f0, svgPaths.p55b1900,
  svgPaths.pce80e80, svgPaths.pe7ea00,
];

export default function SplashScreen({ onComplete }: { onComplete?: () => void }) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    // Flash fires at ~3.3s (300ms after subtitle reveal at ~3.0s)
    const t1 = setTimeout(() => setFlash(true), 3300);
    // Signal completion after flash fades
    const t2 = setTimeout(() => { onComplete?.(); }, 4200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onComplete]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#fffdf7",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* spinner — fades out at 0.8s */}
      <div className="splash-spinner-wrap">
        <div className="splash-spinner" />
      </div>

      {/* logo — the whole SVG, fades in at 0.9s */}
      <div
        className="splash-logo-wrap"
        style={{
          width: "min(540px, 86vw)",
          aspectRatio: "1728 / 663.184",
        }}
      >
        <svg
          viewBox="0 0 1728 663.184"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: "100%", height: "100%", overflow: "visible" }}
        >
          <defs>
            <clipPath id="sp-clip">
              <rect width="1728" height="663.184" />
            </clipPath>
            <mask id="sp-mask-gold" height="394" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="739" x="494" y="6">
              <path d={svgPaths.p3bd5f480} fill="#D9D9D9" />
            </mask>
            <mask id="sp-mask-red" height="193" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} width="362" x="683" y="72">
              <path d={svgPaths.p8e3d700} fill="#D9D9D9" />
            </mask>
          </defs>

          <g clipPath="url(#sp-clip)">

            {/* ── upper group: triangles + ISB letters (scales down at t=2.7s) ── */}
            <g
              className="anim-top-shrink"
              style={{ transformBox: "fill-box", transformOrigin: "center center" }}
            >

              {/* gold triangle – slides up from bottom at t=1.0s */}
              <g
                className="anim-gold"
                style={{ transformBox: "fill-box", transformOrigin: "center bottom" }}
              >
                <g mask="url(#sp-mask-gold)">
                  <path clipRule="evenodd" d="M863.5 0L473 400H863.5V0Z" fill="#F5C400" fillRule="evenodd" />
                  <path d="M1254 400L863.5 0V400H1254Z" fill="#EEA903" />
                </g>
              </g>

              {/* red triangle – scales in at t=1.6s */}
              <g
                className="anim-red"
                style={{ transformBox: "fill-box", transformOrigin: "center bottom" }}
              >
                <g mask="url(#sp-mask-red)">
                  <path clipRule="evenodd" d={svgPaths.p2ef6fa00} fill="#E41D1C" fillRule="evenodd" />
                  <path d={svgPaths.p23c1c200} fill="#BF2D2B" />
                </g>
              </g>

              {/* ISB "I" – bounces up at t=2.0s */}
              <g
                className="anim-letter-I"
                style={{ transformBox: "fill-box", transformOrigin: "center bottom" }}
              >
                <path d={svgPaths.p3cd58200} fill="#32261C" />
              </g>

              {/* ISB "S" – bounces up at t=2.3s */}
              <g
                className="anim-letter-S"
                style={{ transformBox: "fill-box", transformOrigin: "center bottom" }}
              >
                <path d={svgPaths.pd6cc600} fill="#32261C" />
              </g>

              {/* ISB "B" – bounces up at t=2.7s (new B from Vector import) */}
              <g
                className="anim-letter-B"
                style={{ transformBox: "fill-box", transformOrigin: "center bottom" }}
              >
                {/* translate to match old B position: x≈901, y≈298 in main 1728×663 viewBox */}
                <g transform="translate(901, 298)">
                  <path clipRule="evenodd" d={newBPaths.p3420f200} fill="#32261C" fillRule="evenodd" />
                </g>
              </g>

            </g>{/* /anim-top-shrink */}

            {/* ── subtitle: International School Bangkok – fades in at t=3.0s ── */}
            <g className="anim-subtitle">
              {SUBTITLE_PATHS.map((d, i) => (
                <path key={i} d={d} fill="#32261C" />
              ))}
            </g>

          </g>
        </svg>
      </div>

      {/* flash overlay */}
      <div
        className={flash ? "splash-flash splash-flash--active" : "splash-flash"}
      />
    </div>
  );
}
