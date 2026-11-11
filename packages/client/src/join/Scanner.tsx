/**
 * Reading a table's QR code with the camera. It holds the table's link, so a
 * phone's own camera app opens it with no help from here; this is for scanning
 * from inside the app, and it uses the browser's `BarcodeDetector` where there is
 * one. Where there is not (most desktop browsers, Firefox, Safari), it says so and
 * points at the camera app instead: no decoding library is shipped for it.
 */
import { useEffect, useRef, useState } from "react";
import { codeFromScan } from "../roomCode";
import { Button } from "../ui/Button";
import { Icon } from "../ui/icons";

/** The part of the Barcode Detection API this uses; not yet in TypeScript's DOM types. */
interface Detector {
  detect(source: HTMLVideoElement): Promise<readonly { readonly rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** The browser's barcode detector, if it has one. */
function barcodeDetector(): DetectorClass | null {
  const found = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  return typeof found === "function" ? found : null;
}

/** How often the camera's picture is checked for a code. */
const SCAN_EVERY_MS = 250;

type Stage = "idle" | "starting" | "scanning" | "unsupported" | "blocked";

export interface ScannerProps {
  /** A table code was read. */
  readonly onCode: (code: string) => void;
  /** Start the camera at once rather than on a tap (the phone's full-screen scan). */
  readonly autoStart?: boolean;
}

/** The camera's picture inside a green frame, with what to do beneath it. */
export function Scanner({ onCode, autoStart = false }: ScannerProps): React.ReactElement {
  const Detector = barcodeDetector();
  // Whether the camera has been asked for; what came of it is `stage`.
  const [on, setOn] = useState(autoStart && Detector !== null);
  const [stage, setStage] = useState<Stage>(
    Detector ? (autoStart ? "starting" : "idle") : "unsupported",
  );
  const video = useRef<HTMLVideoElement>(null);
  const found = useRef(onCode);
  found.current = onCode;

  useEffect(() => {
    if (!on || !Detector) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let live = true;
    const detector = new Detector({ formats: ["qr_code"] });
    const asked = navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      : Promise.reject(new Error("no camera"));
    asked
      .then(async (s) => {
        stream = s;
        if (!live || !video.current) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
        setStage("scanning");
        timer = setInterval(() => {
          if (!video.current) return;
          void detector
            .detect(video.current)
            .then((codes) => {
              for (const { rawValue } of codes) {
                const code = codeFromScan(rawValue);
                if (code && live) {
                  live = false;
                  found.current(code);
                  return;
                }
              }
            })
            .catch(() => {});
        }, SCAN_EVERY_MS);
      })
      .catch(() => live && setStage("blocked"));
    return () => {
      live = false;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [on, Detector]);

  const message =
    stage === "unsupported"
      ? "This browser can't read QR codes. Point your phone's camera app at the code instead: it opens the table's link."
      : stage === "blocked"
        ? "The camera isn't available. Allow it in your browser's settings, or type the code."
        : "Point at the code on the host's screen.";

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="relative aspect-square w-full max-w-[240px] overflow-hidden rounded-[20px] bg-[radial-gradient(circle_at_50%_45%,#2A3038,#15191D_70%)]">
        <video
          ref={video}
          muted
          playsInline
          aria-label="Camera"
          className={`absolute inset-0 h-full w-full object-cover ${stage === "scanning" ? "" : "hidden"}`}
        />
        {stage !== "scanning" && (
          <span className="absolute inset-0 flex items-center justify-center text-muted">
            <Icon name="camera" size={40} />
          </span>
        )}
        <Corners />
      </div>
      <p role="status" className="m-0 max-w-[280px] text-sm text-muted">
        {message}
      </p>
      {stage === "idle" && (
        <Button
          variant="secondary"
          onClick={() => {
            setStage("starting");
            setOn(true);
          }}
        >
          Turn on camera
        </Button>
      )}
    </div>
  );
}

/** The four green corners of the viewfinder. */
function Corners(): React.ReactElement {
  const corner = "absolute h-8 w-8 border-accent";
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-4">
      <span className={`${corner} top-0 left-0 rounded-tl-xl border-t-[3px] border-l-[3px]`} />
      <span className={`${corner} top-0 right-0 rounded-tr-xl border-t-[3px] border-r-[3px]`} />
      <span className={`${corner} bottom-0 left-0 rounded-bl-xl border-b-[3px] border-l-[3px]`} />
      <span className={`${corner} right-0 bottom-0 rounded-br-xl border-r-[3px] border-b-[3px]`} />
    </span>
  );
}
