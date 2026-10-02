import { memo, useEffect, useRef, useState } from "react";

// Keep the thumbnail's space when it leaves its scroll panel, but release the
// image element so a long history does not keep every decoded image mounted.
export const ViewportImage = memo(function ViewportImage({ src, className }: { src: string; className: string }) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: frame.closest(".eaa-messages, .eaa-images, .eaa-gallery-grid"),
      rootMargin: "200px",
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <span className={`eaa-image-frame ${className}`} ref={frameRef}>
      {visible ? <img src={src} decoding="async" alt="" /> : null}
    </span>
  );
});
