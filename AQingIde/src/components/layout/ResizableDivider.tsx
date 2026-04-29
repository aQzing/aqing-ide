import React, { useCallback, useState } from "react";

interface ResizableDividerProps {
  onDrag: (delta: number) => void;
}

const ResizableDivider: React.FC<ResizableDividerProps> = ({ onDrag }) => {
  const [dragging, setDragging] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      let lastX = e.clientX;
      setDragging(true);

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - lastX;
        lastX = ev.clientX;
        onDrag(delta);
      };

      const handleMouseUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onDrag]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: "4px",
        flexShrink: 0,
        cursor: "col-resize",
        backgroundColor: dragging ? "#007acc" : "transparent",
        transition: "background-color 0.15s",
        position: "relative",
        zIndex: 10,
      }}
      onMouseEnter={(e) => {
        if (!dragging) (e.currentTarget as HTMLDivElement).style.backgroundColor = "#007acc55";
      }}
      onMouseLeave={(e) => {
        if (!dragging) (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent";
      }}
    />
  );
};

export default ResizableDivider;
