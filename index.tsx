/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'preact';
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { html } from 'htm/preact';
import { GoogleGenAI, Modality, Type } from '@google/genai';

const API_KEY = process.env.API_KEY;

// --- Helper Functions ---
const getCanvasBlob = (canvas) => {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas is empty or not supported.'));
      }
    }, 'image/png');
  });
};

const blobToBase64 = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      resolve(base64data.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const generateId = () => `id_${Math.random().toString(36).substr(2, 9)}`;

const rotatePoint = (point, center, angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos
    };
};


// --- Main App Component ---
function App() {
  const [ai, setAi] = useState(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const previewCtxRef = useRef(null);
  const isInteracting = useRef(false);
  const startCoords = useRef({ x: 0, y: 0 });
  const shapePopoverRef = useRef(null);
  const dragInfo = useRef(null);

  // --- State ---
  const [shapes, setShapes] = useState([]);
  const [canvasBackground, setCanvasBackground] = useState('#FFFFFF');
  const [selectedShapeIds, setSelectedShapeIds] = useState([]);
  const [tool, setTool] = useState('pencil');
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [fillColor, setFillColor] = useState('#f94144');
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [gradientType, setGradientType] = useState('linear');
  const [gradientColor1, setGradientColor1] = useState('#6a5acd');
  const [gradientColor2, setGradientColor2] = useState('#f3722c');

  const [prompt, setPrompt] = useState('A cute, fluffy cat wearing a wizard hat.');
  const [style, setStyle] = useState('Cartoon');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [output, setOutput] = useState(null);
  
  const [history, setHistory] = useState([{ shapes: [], background: '#FFFFFF' }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [palette, setPalette] = useState(['#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#577590']);
  const [palettePrompt, setPalettePrompt] = useState('Vibrant cyberpunk city');
  const [isGeneratingPalette, setIsGeneratingPalette] = useState(false);
  const [isShapePopoverOpen, setIsShapePopoverOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [cursorStyle, setCursorStyle] = useState('default');
  const [openSections, setOpenSections] = useState({ toolOptions: true, shapeProperties: true, aiStudio: true });


  const shapeTools = ['line', 'rectangle', 'circle', 'triangle', 'star', 'pentagon', 'hexagon'];
  const isShapeTool = shapeTools.includes(tool);
  const selectedShapes = shapes.filter(s => selectedShapeIds.includes(s.id));

  // --- Initialize AI Client & Canvas ---
  useEffect(() => {
    try {
      if (!API_KEY) throw new Error("API_KEY environment variable not set.");
      setAi(new GoogleGenAI({ apiKey: API_KEY }));
    } catch (e) {
      console.error(e);
      setError('Failed to initialize AI client. Check API key.');
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!canvas || !previewCanvas) return;
    const observer = new ResizeObserver(() => {
        const parent = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const rect = parent.getBoundingClientRect();
        
        [canvas, previewCanvas].forEach(c => {
            c.width = rect.width * dpr;
            c.height = rect.height * dpr;
            const ctx = c.getContext('2d');
            ctx.scale(dpr, dpr);
        });

        ctxRef.current = canvas.getContext('2d');
        previewCtxRef.current = previewCanvas.getContext('2d');
        
        redrawCanvas();
    });
    observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [shapes, canvasBackground]); // Redraw on resize

  useEffect(() => {
    const handleClickOutside = (event) => {
        if (shapePopoverRef.current && !shapePopoverRef.current.contains(event.target)) {
            setIsShapePopoverOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- Drawing & History Logic ---
  const saveState = useCallback(() => {
    const newHistory = history.slice(0, historyIndex + 1);
    const currentState = {
        shapes: JSON.parse(JSON.stringify(shapes)),
        background: canvasBackground
    };
    if (JSON.stringify(currentState) === JSON.stringify(newHistory[newHistory.length - 1])) {
        return;
    }
    newHistory.push(currentState);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex, shapes, canvasBackground]);

  const restoreState = useCallback((index) => {
    if (index < 0 || index >= history.length) return;
    const stateToRestore = history[index];
    setShapes(stateToRestore.shapes);
    setCanvasBackground(stateToRestore.background);
    setSelectedShapeIds([]);
  }, [history]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      restoreState(newIndex);
    }
  };
  
  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      restoreState(newIndex);
    }
  };

  const getCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const getShapeVertices = (shapeType, start, end) => {
      const width = end.x - start.x;
      const height = end.y - start.y;
      const vertices = [];
      
      switch(shapeType) {
        case 'triangle':
            vertices.push({ x: start.x + width / 2, y: start.y });
            vertices.push({ x: start.x, y: end.y });
            vertices.push({ x: end.x, y: end.y });
            break;
        case 'star':
            const outerRadius = Math.min(Math.abs(width), Math.abs(height)) / 2;
            const innerRadius = outerRadius / 2;
            const starCenterX = start.x + width / 2;
            const starCenterY = start.y + height / 2;
            for (let i = 0; i < 10; i++) {
                const radius = i % 2 === 0 ? outerRadius : innerRadius;
                const angle = i * Math.PI / 5 - Math.PI / 2;
                vertices.push({ x: starCenterX + radius * Math.cos(angle), y: starCenterY + radius * Math.sin(angle) });
            }
            break;
        case 'pentagon':
        case 'hexagon':
            const sides = shapeType === 'pentagon' ? 5 : 6;
            const polyCenterX = start.x + width / 2;
            const polyCenterY = start.y + height / 2;
            const polyRadius = Math.min(Math.abs(width), Math.abs(height)) / 2;
            for (let i = 0; i < sides; i++) {
                const angle = (i * 2 * Math.PI / sides) - (Math.PI / 2);
                vertices.push({ x: polyCenterX + polyRadius * Math.cos(angle), y: polyCenterY + polyRadius * Math.sin(angle) });
            }
            break;
      }
      return vertices;
  }

  const drawShapeObject = (ctx, shape, offsetX = 0, offsetY = 0) => {
    ctx.globalCompositeOperation = shape.composite || 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.save();
    ctx.translate(offsetX, offsetY);
    
    if (shape.rotation) {
        const unrotatedBounds = getShapeBounds({ ...shape, rotation: 0 });
        const centerX = unrotatedBounds.x + unrotatedBounds.width / 2;
        const centerY = unrotatedBounds.y + unrotatedBounds.height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate(shape.rotation);
        ctx.translate(-centerX, -centerY);
    }
    
    ctx.beginPath();
    
    switch (shape.type) {
      case 'group':
        shape.children.forEach(child => drawShapeObject(ctx, child, shape.x, shape.y));
        ctx.restore();
        return;
      case 'pencil':
      case 'eraser':
        if (shape.points.length < 2) break;
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for(let i = 1; i < shape.points.length; i++) {
          ctx.lineTo(shape.points[i].x, shape.points[i].y);
        }
        break;
      case 'line':
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        break;
      case 'rectangle':
        ctx.rect(shape.x, shape.y, shape.width, shape.height);
        break;
      case 'circle':
        ctx.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, Math.abs(shape.width / 2), Math.abs(shape.height / 2), 0, 0, 2 * Math.PI);
        break;
      case 'triangle':
      case 'star':
      case 'pentagon':
      case 'hexagon':
        if (shape.vertices.length < 2) break;
        ctx.moveTo(shape.vertices[0].x, shape.vertices[0].y);
        for (let i = 1; i < shape.vertices.length; i++) {
            ctx.lineTo(shape.vertices[i].x, shape.vertices[i].y);
        }
        ctx.closePath();
        break;
    }

    if (shape.fill) {
        if (typeof shape.fill === 'string') {
            ctx.fillStyle = shape.fill;
        } else if (shape.fill.type === 'gradient') {
            const bounds = getShapeBounds({ ...shape, rotation: 0 });
            let gradient;
            if (shape.fill.gradientType === 'linear') {
                gradient = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
            } else {
                const centerX = bounds.x + bounds.width / 2;
                const centerY = bounds.y + bounds.height / 2;
                const radius = Math.max(bounds.width, bounds.height) / 2;
                gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
            }
            gradient.addColorStop(0, shape.fill.colors[0]);
            gradient.addColorStop(1, shape.fill.colors[1]);
            ctx.fillStyle = gradient;
        }
        ctx.fill();
    }
    
    if (shape.stroke) {
        ctx.lineWidth = shape.stroke.width;
        ctx.strokeStyle = shape.stroke.color;
        ctx.stroke();
    } else if (shape.type === 'pencil' || shape.type === 'eraser') {
        ctx.lineWidth = shape.size;
        ctx.strokeStyle = shape.color;
        ctx.stroke();
    }
    
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  };
  
  const getShapeBounds = (shape) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    if (shape.type === 'group') {
      shape.children.forEach(child => {
        const childBounds = getShapeBounds(child);
        minX = Math.min(minX, shape.x + childBounds.x);
        minY = Math.min(minY, shape.y + childBounds.y);
        maxX = Math.max(maxX, shape.x + childBounds.x + childBounds.width);
        maxY = Math.max(maxY, shape.y + childBounds.y + childBounds.height);
      });
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    const unrotatedBounds = getUnrotatedShapeBounds(shape);
    if (!shape.rotation) return unrotatedBounds;

    const centerX = unrotatedBounds.x + unrotatedBounds.width / 2;
    const centerY = unrotatedBounds.y + unrotatedBounds.height / 2;
    const center = { x: centerX, y: centerY };

    const corners = [
        { x: unrotatedBounds.x, y: unrotatedBounds.y },
        { x: unrotatedBounds.x + unrotatedBounds.width, y: unrotatedBounds.y },
        { x: unrotatedBounds.x, y: unrotatedBounds.y + unrotatedBounds.height },
        { x: unrotatedBounds.x + unrotatedBounds.width, y: unrotatedBounds.y + unrotatedBounds.height },
    ];
    
    const rotatedCorners = corners.map(p => rotatePoint(p, center, shape.rotation));
    rotatedCorners.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    });

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  
  const getUnrotatedShapeBounds = (shape) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    const points = shape.points ?? shape.vertices ?? [
        {x: shape.x1 ?? shape.x, y: shape.y1 ?? shape.y}, 
        {x: shape.x2 ?? (shape.x + shape.width), y: shape.y2 ?? (shape.y + shape.height)}
    ];
    if (shape.type === 'circle') {
        const rx = Math.abs(shape.width/2);
        const ry = Math.abs(shape.height/2);
        const cx = shape.x + shape.width/2;
        const cy = shape.y + shape.height/2;
        return { x: cx - rx, y: cy - ry, width: rx*2, height: ry*2 };
    }
     if (shape.type === 'group') {
        shape.children.forEach(child => {
            const childBounds = getUnrotatedShapeBounds(child);
            minX = Math.min(minX, shape.x + childBounds.x);
            minY = Math.min(minY, shape.y + childBounds.y);
            maxX = Math.max(maxX, shape.x + childBounds.x + childBounds.width);
            maxY = Math.max(maxY, shape.y + childBounds.y + childBounds.height);
        });
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    points.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    });
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  
  const getSelectionBounds = (selection) => {
    if (selection.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selection.forEach(s => {
        const bounds = getShapeBounds(s);
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
    });
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };

  const getResizeHandles = (bounds) => {
    if (!bounds) return [];
    const { x, y, width, height } = bounds;
    return [
      { pos: 'top-left', cursor: 'nwse-resize', x: x, y: y },
      { pos: 'top-middle', cursor: 'ns-resize', x: x + width / 2, y: y },
      { pos: 'top-right', cursor: 'nesw-resize', x: x + width, y: y },
      { pos: 'middle-left', cursor: 'ew-resize', x: x, y: y + height / 2 },
      { pos: 'middle-right', cursor: 'ew-resize', x: x + width, y: y + height / 2 },
      { pos: 'bottom-left', cursor: 'nesw-resize', x: x, y: y + height },
      { pos: 'bottom-middle', cursor: 'ns-resize', x: x + width / 2, y: y + height },
      { pos: 'bottom-right', cursor: 'nwse-resize', x: x + width, y: y + height },
    ];
  };
  
    const getRotationHandlePosition = (bounds) => {
        if (!bounds) return null;
        return { x: bounds.x + bounds.width / 2, y: bounds.y - 20 };
    };

    const isPointOnRotationHandle = (point, bounds) => {
        const handle = getRotationHandlePosition(bounds);
        if (!handle) return false;
        const handleSize = 10;
        return Math.hypot(point.x - handle.x, point.y - handle.y) < handleSize;
    };
  
  const getResizeHandleAtPosition = (point, bounds) => {
    const handles = getResizeHandles(bounds);
    const handleSize = 10;
    for (const handle of handles) {
      if (
        point.x >= handle.x - handleSize / 2 &&
        point.x <= handle.x + handleSize / 2 &&
        point.y >= handle.y - handleSize / 2 &&
        point.y <= handle.y + handleSize / 2
      ) {
        return handle;
      }
    }
    return null;
  };

  const drawSelectionUI = (ctx, bounds) => {
    if (!bounds) return;
    const handleSize = 8;
    
    // Draw rotation handle line
    const rotationHandle = getRotationHandlePosition(bounds);
    ctx.beginPath();
    ctx.moveTo(bounds.x + bounds.width / 2, bounds.y);
    ctx.lineTo(rotationHandle.x, rotationHandle.y);
    ctx.strokeStyle = 'rgba(106, 90, 205, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw bounding box
    ctx.strokeStyle = 'rgba(106, 90, 205, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.setLineDash([]);
    
    // Draw resize handles
    const handles = getResizeHandles(bounds);
    ctx.fillStyle = 'rgba(106, 90, 205, 1)';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    handles.forEach(handle => {
        ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
    });

    // Draw rotation handle circle
    ctx.beginPath();
    ctx.arc(rotationHandle.x, rotationHandle.y, handleSize/2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  };

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!ctx || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (typeof canvasBackground === 'string') {
        ctx.fillStyle = canvasBackground;
        ctx.fillRect(0, 0, width, height);
    } else if (canvasBackground.type === 'gradient') {
        let gradient;
        if (canvasBackground.gradientType === 'linear') {
            gradient = ctx.createLinearGradient(0, 0, width, height);
        } else {
            gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 2);
        }
        gradient.addColorStop(0, canvasBackground.colors[0]);
        gradient.addColorStop(1, canvasBackground.colors[1]);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    }

    shapes.forEach(shape => drawShapeObject(ctx, shape));

    const previewCtx = previewCtxRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!previewCtx || !previewCanvas) return;
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    
    if (selectedShapeIds.length > 0) {
        const selectionBounds = getSelectionBounds(shapes.filter(s => selectedShapeIds.includes(s.id)));
        if (selectionBounds) {
            drawSelectionUI(previewCtx, selectionBounds);
        }
    }
  }, [shapes, selectedShapeIds, canvasBackground]);

  useEffect(() => {
    redrawCanvas();
  }, [shapes, selectedShapeIds, redrawCanvas, canvasBackground]);


  const isPointInShape = (point, shape) => {
    const unrotatedBounds = getUnrotatedShapeBounds(shape);
    const centerX = unrotatedBounds.x + unrotatedBounds.width / 2;
    const centerY = unrotatedBounds.y + unrotatedBounds.height / 2;
    const unrotatedPoint = shape.rotation ? rotatePoint(point, { x: centerX, y: centerY }, -shape.rotation) : point;
    const { x, y } = unrotatedPoint;
    
    const tolerance = 5 + (shape.stroke?.width ?? shape.size ?? 4) / 2;

    if (shape.type === 'group') {
      for (const child of shape.children) {
        const translatedPoint = { x: x - shape.x, y: y - shape.y };
        if (isPointInShape(translatedPoint, child)) return true;
      }
      return false;
    }

    const bounds = getUnrotatedShapeBounds(shape); // Use unrotated for hit check
    if (x < bounds.x - tolerance || x > bounds.x + bounds.width + tolerance || y < bounds.y - tolerance || y > bounds.y + bounds.height + tolerance) {
      return false;
    }

    if (shape.fill) {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.beginPath();
        switch(shape.type) {
            case 'rectangle': tempCtx.rect(shape.x, shape.y, shape.width, shape.height); break;
            case 'circle': tempCtx.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, Math.abs(shape.width / 2), Math.abs(shape.height / 2), 0, 0, 2 * Math.PI); break;
            case 'triangle': case 'star': case 'pentagon': case 'hexagon':
                if (shape.vertices.length > 2) {
                    tempCtx.moveTo(shape.vertices[0].x, shape.vertices[0].y);
                    for (let i = 1; i < shape.vertices.length; i++) tempCtx.lineTo(shape.vertices[i].x, shape.vertices[i].y);
                    tempCtx.closePath();
                }
                break;
        }
        if (tempCtx.isPointInPath(x, y)) return true;
    }

    switch(shape.type) {
        case 'rectangle':
            return isPointInShape({x,y}, {...shape, fill: 'black'});
        case 'circle':
            const dx = x - (shape.x + shape.width/2), dy = y - (shape.y + shape.height/2);
            const rx = shape.width/2, ry = shape.height/2;
            const dist = (dx*dx)/(rx*rx) + (dy*dy)/(ry*ry);
            const toleranceRatio = tolerance / Math.max(rx, ry);
            return dist <= 1.1 && dist >= 1 - toleranceRatio;
        case 'line':
            const { x1, y1, x2, y2 } = shape;
            const l2 = (x2-x1)**2 + (y2-y1)**2;
            if (l2 === 0) return Math.hypot(x-x1, y-y1) < tolerance;
            let t = ((x-x1)*(x2-x1) + (y-y1)*(y2-y1)) / l2;
            t = Math.max(0, Math.min(1, t));
            const projX = x1 + t * (x2 - x1), projY = y1 + t * (y2 - y1);
            return Math.hypot(x - projX, y - projY) < tolerance;
        case 'pencil':
        case 'eraser':
            for (let i = 0; i < shape.points.length - 1; i++) {
                 const p1 = shape.points[i], p2 = shape.points[i+1];
                 const l2_path = (p2.x-p1.x)**2 + (p2.y-p1.y)**2;
                 if (l2_path === 0) continue;
                 let t_path = ((x-p1.x)*(p2.x-p1.x) + (y-p1.y)*(p2.y-p1.y)) / l2_path;
                 t_path = Math.max(0, Math.min(1, t_path));
                 const projX_path = p1.x + t_path * (p2.x - p1.x), projY_path = p1.y + t_path * (p2.y - p1.y);
                 if (Math.hypot(x - projX_path, y - projY_path) < tolerance) return true;
            }
            return false;
        default: return false;
    }
  }
  
  const scaleShape = (shape, oldBounds, newBounds) => {
    const newShape = JSON.parse(JSON.stringify(shape));
    const sx = newBounds.width / oldBounds.width;
    const sy = newBounds.height / oldBounds.height;
  
    const transformPoint = p => ({
      x: newBounds.x + (p.x - oldBounds.x) * sx,
      y: newBounds.y + (p.y - oldBounds.y) * sy
    });
  
    if (newShape.type === 'pencil' || newShape.type === 'eraser') {
      newShape.points = newShape.points.map(transformPoint);
    } else if (newShape.hasOwnProperty('x1')) {
      const p1 = transformPoint({ x: newShape.x1, y: newShape.y1 });
      const p2 = transformPoint({ x: newShape.x2, y: newShape.y2 });
      newShape.x1 = p1.x; newShape.y1 = p1.y;
      newShape.x2 = p2.x; newShape.y2 = p2.y;
    } else if (newShape.hasOwnProperty('vertices')) {
      newShape.vertices = newShape.vertices.map(transformPoint);
    } else if (newShape.type === 'group') {
      newShape.x = newBounds.x;
      newShape.y = newBounds.y;
      const childOldBounds = { x: 0, y: 0, width: oldBounds.width, height: oldBounds.height };
      const childNewBounds = { x: 0, y: 0, width: newBounds.width, height: newBounds.height };
      newShape.children = newShape.children.map(child => scaleShape(child, childOldBounds, childNewBounds));
    } else {
      const transformed = transformPoint({ x: newShape.x, y: newShape.y });
      newShape.x = transformed.x;
      newShape.y = transformed.y;
      newShape.width *= sx;
      newShape.height *= sy;
    }
    return newShape;
  };
  
  const startInteraction = useCallback((e) => {
    e.preventDefault();
    isInteracting.current = true;
    const coords = getCoords(e);
    startCoords.current = coords;

    if (tool === 'select') {
      const selectionBounds = getSelectionBounds(selectedShapes);
      const resizeHandle = getResizeHandleAtPosition(coords, selectionBounds);
      const rotationHandle = isPointOnRotationHandle(coords, selectionBounds);

      if (rotationHandle) {
        const centerX = selectionBounds.x + selectionBounds.width / 2;
        const centerY = selectionBounds.y + selectionBounds.height / 2;
        dragInfo.current = {
            type: 'rotate',
            initialShapes: JSON.parse(JSON.stringify(selectedShapes)),
            center: { x: centerX, y: centerY },
            startAngle: Math.atan2(coords.y - centerY, coords.x - centerX)
        };
        return;
      }

      if (resizeHandle) {
        dragInfo.current = {
          type: 'resize',
          handle: resizeHandle.pos,
          initialShapes: JSON.parse(JSON.stringify(selectedShapes)),
          initialBounds: selectionBounds,
          initialMousePos: coords,
          aspectRatio: selectionBounds.width / selectionBounds.height,
        };
        return;
      }

      let clickedShape = null;
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (isPointInShape(coords, shapes[i])) {
          clickedShape = shapes[i];
          break;
        }
      }

      const currentSelection = e.shiftKey ? selectedShapeIds : [];
      if (clickedShape) {
        if (currentSelection.includes(clickedShape.id)) {
          setSelectedShapeIds(currentSelection.filter(id => id !== clickedShape.id));
        } else {
          setSelectedShapeIds([...currentSelection, clickedShape.id]);
        }
      } else {
        setSelectedShapeIds(currentSelection);
      }
      
      const newSelectedShapeIds = clickedShape ? (e.shiftKey ? (selectedShapeIds.includes(clickedShape.id) ? selectedShapeIds.filter(id => id !== clickedShape.id) : [...selectedShapeIds, clickedShape.id]) : [clickedShape.id]) : (e.shiftKey ? selectedShapeIds : []);
      
      if (newSelectedShapeIds.length > 0) {
        dragInfo.current = {
          type: 'move',
          initialShapes: JSON.parse(JSON.stringify(shapes.filter(s => newSelectedShapeIds.includes(s.id)))),
          initialMousePos: coords
        };
      } else {
          dragInfo.current = null;
      }
      setSelectedShapeIds(newSelectedShapeIds);
      return;
    }

    setSelectedShapeIds([]);
    if (tool === 'pencil' || tool === 'eraser') {
      const newPath = {
        id: generateId(),
        type: tool,
        points: [coords],
        color: color,
        size: brushSize,
        composite: tool === 'eraser' ? 'destination-out' : 'source-over',
        rotation: 0,
      };
      setShapes(prev => [...prev, newPath]);
    }
  }, [tool, shapes, color, brushSize, selectedShapeIds, selectedShapes]);

  const moveInteraction = useCallback((e) => {
    if (!isInteracting.current && tool === 'select') {
        const coords = getCoords(e);
        const selectionBounds = getSelectionBounds(selectedShapes);
        const handle = getResizeHandleAtPosition(coords, selectionBounds);
        const rotationHandle = isPointOnRotationHandle(coords, selectionBounds);
        if (handle) setCursorStyle(handle.cursor);
        else if (rotationHandle) setCursorStyle('grabbing');
        else setCursorStyle('default');
        return;
    }
    if (!isInteracting.current) return;
    e.preventDefault();
    const coords = getCoords(e);

    if (tool === 'select' && dragInfo.current) {
        if (dragInfo.current.type === 'rotate') {
            const { center, startAngle, initialShapes } = dragInfo.current;
            let currentAngle = Math.atan2(coords.y - center.y, coords.x - center.x);
            let angleDelta = currentAngle - startAngle;

            if (e.shiftKey) {
                const snapAngle = 15 * (Math.PI / 180);
                angleDelta = Math.round(angleDelta / snapAngle) * snapAngle;
            }

            setShapes(currentShapes => currentShapes.map(s => {
                const initial = initialShapes.find(is => is.id === s.id);
                if (initial) {
                    return { ...s, rotation: (initial.rotation || 0) + angleDelta };
                }
                return s;
            }));

        } else if (dragInfo.current.type === 'resize') {
            const { initialBounds, initialMousePos, handle, aspectRatio, initialShapes } = dragInfo.current;
            const dx = coords.x - initialMousePos.x;
            const dy = coords.y - initialMousePos.y;
            let newBounds = { ...initialBounds };
            
            if (handle.includes('right')) newBounds.width += dx;
            if (handle.includes('bottom')) newBounds.height += dy;
            if (handle.includes('left')) { newBounds.x += dx; newBounds.width -= dx; }
            if (handle.includes('top')) { newBounds.y += dy; newBounds.height -= dy; }

            if (e.shiftKey && handle.includes('-')) {
                const isDiagonal = handle.includes('left') || handle.includes('right');
                if (isDiagonal) {
                    const newWidth = newBounds.width;
                    const newHeight = newWidth / aspectRatio;
                    if (handle.includes('top')) {
                        newBounds.y -= (newHeight - initialBounds.height);
                    }
                    newBounds.height = newHeight;
                } else {
                    const newHeight = newBounds.height;
                    const newWidth = newHeight * aspectRatio;
                    if (handle.includes('left')) {
                        newBounds.x -= (newWidth - initialBounds.width);
                    }
                    newBounds.width = newWidth;
                }
            }

            if (newBounds.width < 0) {
                newBounds.x += newBounds.width;
                newBounds.width = Math.abs(newBounds.width);
            }
            if (newBounds.height < 0) {
                newBounds.y += newBounds.height;
                newBounds.height = Math.abs(newBounds.height);
            }
            
            const scaledShapes = initialShapes.map(s => scaleShape(s, initialBounds, newBounds));

            setShapes(currentShapes =>
                currentShapes.map(s => {
                    const scaledVersion = scaledShapes.find(ss => ss.id === s.id);
                    return scaledVersion || s;
                })
            );
        } else if (dragInfo.current.type === 'move') {
            const { initialShapes, initialMousePos } = dragInfo.current;
            const dx = coords.x - initialMousePos.x;
            const dy = coords.y - initialMousePos.y;

            setShapes(currentShapes => currentShapes.map(s => {
                const initial = initialShapes.find(is => is.id === s.id);
                return initial ? translateShape(s, initial.x - s.x + dx, initial.y - s.y + dy, initial) : s;
            }));
        }
    } else if (tool === 'pencil' || tool === 'eraser') {
      setShapes(prev => {
        const newShapes = [...prev];
        const currentPath = newShapes[newShapes.length - 1];
        if (currentPath && (currentPath.type === 'pencil' || currentPath.type === 'eraser')) {
          currentPath.points.push(coords);
        }
        return newShapes;
      });
    } else if (isShapeTool) {
      const previewCtx = previewCtxRef.current;
      const previewCanvas = previewCanvasRef.current;
      if (!previewCtx || !previewCanvas) return;
      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      const tempShape = {
        type: tool, 
        fill: fillColor, 
        stroke: { color: strokeColor, width: strokeWidth },
        x1: startCoords.current.x, y1: startCoords.current.y, x2: coords.x, y2: coords.y,
        x: Math.min(startCoords.current.x, coords.x), y: Math.min(startCoords.current.y, coords.y), 
        width: Math.abs(coords.x - startCoords.current.x), height: Math.abs(coords.y - startCoords.current.y),
        vertices: getShapeVertices(tool, startCoords.current, coords),
        rotation: 0
      };
      drawShapeObject(previewCtx, tempShape);
    }
  }, [tool, isShapeTool, selectedShapes, fillColor, strokeColor, strokeWidth]);

  const endInteraction = useCallback((e) => {
    if (!isInteracting.current) return;
    isInteracting.current = false;
    
    if (tool === 'select') {
      if (dragInfo.current) saveState();
      dragInfo.current = null;
      return;
    }
    
    if (isShapeTool) {
      const coords = getCoords(e);
      const start = startCoords.current;
      const newShape = {
          id: generateId(), type: tool,
          fill: fillColor, 
          stroke: { color: strokeColor, width: strokeWidth },
          x1: start.x, y1: start.y, x2: coords.x, y2: coords.y,
          x: Math.min(start.x, coords.x), y: Math.min(start.y, coords.y),
          width: Math.abs(coords.x - start.x), height: Math.abs(coords.y - start.y),
          vertices: getShapeVertices(tool, start, coords),
          rotation: 0,
      };
      setShapes(prev => [...prev, newShape]);
      
      const previewCtx = previewCtxRef.current;
      previewCtx.clearRect(0, 0, previewCtx.canvas.width, previewCtx.canvas.height);
    }
    saveState();
  }, [tool, isShapeTool, fillColor, strokeColor, strokeWidth, saveState]);

  const clearCanvas = () => {
    const newHistory = history.slice(0, historyIndex + 1);
    const clearedState = { shapes: [], background: '#FFFFFF' };
    newHistory.push(clearedState);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setShapes([]);
    setCanvasBackground('#FFFFFF');
    setSelectedShapeIds([]);
  };
  
  useEffect(() => {
    if (selectedShapes.length === 1) {
      const s = selectedShapes[0];
      if (typeof s.fill === 'string') setFillColor(s.fill);
      if (s.stroke) {
        setStrokeColor(s.stroke.color);
        setStrokeWidth(s.stroke.width);
      }
    }
  }, [selectedShapeIds, shapes]);

  const handleShapeControlChange = (prop, subprop, value) => {
    if (selectedShapeIds.length === 0) return;
    
    const applyChange = (shape) => {
        if (shape.type === 'group') {
            return { ...shape, children: shape.children.map(applyChange) };
        }
        const newShape = {...shape};
        if (prop === 'fill') {
            newShape.fill = value;
        } else if (prop === 'stroke') {
            newShape.stroke = { ...newShape.stroke, [subprop]: value };
        } else if (prop === 'rotation') {
            newShape.rotation = value;
        }
        return newShape;
    };
    
    setShapes(currentShapes => currentShapes.map(s => {
        if (selectedShapeIds.includes(s.id)) {
            return applyChange(s);
        }
        return s;
    }));
  };

  const handleGroup = () => {
    if (selectedShapeIds.length < 2) return;
    
    const shapesToGroup = shapes.filter(s => selectedShapeIds.includes(s.id));
    const remainingShapes = shapes.filter(s => !selectedShapeIds.includes(s.id));

    const groupBounds = getSelectionBounds(shapesToGroup);

    const makeRelative = (shape, groupX, groupY) => {
        const newShape = JSON.parse(JSON.stringify(shape));
        if (newShape.type === 'pencil' || newShape.type === 'eraser') {
            newShape.points = newShape.points.map(p => ({ x: p.x - groupX, y: p.y - groupY }));
        } else if (newShape.hasOwnProperty('x1')) {
            newShape.x1 -= groupX; newShape.y1 -= groupY;
            newShape.x2 -= groupX; newShape.y2 -= groupY;
        } else if (newShape.hasOwnProperty('vertices')) {
            newShape.vertices = newShape.vertices.map(v => ({ x: v.x - groupX, y: v.y - groupY }));
        } else if (newShape.type === 'group') {
            newShape.x -= groupX; newShape.y -= groupY;
        } else {
            newShape.x -= groupX; newShape.y -= groupY;
        }
        return newShape;
    };
    
    const newGroup = {
        id: generateId(),
        type: 'group',
        x: groupBounds.x, y: groupBounds.y,
        children: shapesToGroup.map(s => makeRelative(s, groupBounds.x, groupBounds.y)),
        rotation: 0
    };

    setShapes([...remainingShapes, newGroup]);
    setSelectedShapeIds([newGroup.id]);
    saveState();
  };

  const handleUngroup = () => {
    if (selectedShapeIds.length !== 1) return;
    const group = shapes.find(s => s.id === selectedShapeIds[0]);
    if (!group || group.type !== 'group') return;
    
    const remainingShapes = shapes.filter(s => s.id !== group.id);

    const makeAbsolute = (shape, groupX, groupY) => {
        const newShape = JSON.parse(JSON.stringify(shape));
        if (newShape.type === 'pencil' || newShape.type === 'eraser') {
            newShape.points = newShape.points.map(p => ({ x: p.x + groupX, y: p.y + groupY }));
        } else if (newShape.hasOwnProperty('x1')) {
            newShape.x1 += groupX; newShape.y1 += groupY;
            newShape.x2 += groupX; newShape.y2 += groupY;
        } else if (newShape.hasOwnProperty('vertices')) {
            newShape.vertices = newShape.vertices.map(v => ({ x: v.x + groupX, y: v.y + groupY }));
        } else if (newShape.type === 'group') {
            newShape.x += groupX; newShape.y += groupY;
        } else {
            newShape.x += groupX; newShape.y += groupY;
        }
        return newShape;
    };

    const ungroupedChildren = group.children.map(child => makeAbsolute(child, group.x, group.y));
    
    setShapes([...remainingShapes, ...ungroupedChildren]);
    setSelectedShapeIds(ungroupedChildren.map(c => c.id));
    saveState();
  };

  const translateShape = (shape, dx, dy, initialShape) => {
    const newShape = JSON.parse(JSON.stringify(shape));
    if (newShape.type === 'pencil' || newShape.type === 'eraser') {
        newShape.points = initialShape.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    } else if (newShape.hasOwnProperty('x1')) {
        newShape.x1 = initialShape.x1 + dx; newShape.y1 = initialShape.y1 + dy;
        newShape.x2 = initialShape.x2 + dx; newShape.y2 = initialShape.y2 + dy;
    } else if (newShape.hasOwnProperty('vertices')) {
        newShape.vertices = initialShape.vertices.map(v => ({ x: v.x + dx, y: v.y + dy }));
    } else {
        newShape.x = initialShape.x + dx; newShape.y = initialShape.y + dy;
    }
    return newShape;
  };

  const handleAlignment = (alignment) => {
      if (selectedShapeIds.length < 2) return;
      const selected = shapes.filter(s => selectedShapeIds.includes(s.id));
      
      const overallBounds = getSelectionBounds(selected);

      const newShapes = shapes.map(shape => {
          if (!selectedShapeIds.includes(shape.id)) {
              return shape;
          }
          
          const shapeBounds = getShapeBounds(shape);
          let dx = 0, dy = 0;

          switch (alignment) {
              case 'left':
                  dx = overallBounds.x - shapeBounds.x;
                  break;
              case 'center':
                  dx = (overallBounds.x + overallBounds.width / 2) - (shapeBounds.x + shapeBounds.width / 2);
                  break;
              case 'right':
                  dx = (overallBounds.x + overallBounds.width) - (shapeBounds.x + shapeBounds.width);
                  break;
              case 'top':
                  dy = overallBounds.y - shapeBounds.y;
                  break;
              case 'middle':
                  dy = (overallBounds.y + overallBounds.height / 2) - (shapeBounds.y + shapeBounds.height / 2);
                  break;
              case 'bottom':
                  dy = (overallBounds.y + overallBounds.height) - (shapeBounds.y + shapeBounds.height);
                  break;
          }
          return translateShape(shape, dx, dy, shape);
      });
      
      setShapes(newShapes);
      saveState();
  };
  
    const showFeedback = (message) => {
        setFeedbackMessage(message);
        setTimeout(() => setFeedbackMessage(''), 3000);
    };

    const handleSave = () => {
        try {
            const stateToSave = JSON.stringify({ shapes, history, historyIndex, background: canvasBackground });
            localStorage.setItem('artifex-sketch', stateToSave);
            showFeedback('Sketch saved successfully!');
        } catch (error) {
            console.error('Failed to save sketch:', error);
            showFeedback('Error: Could not save sketch.');
        }
    };

    const handleLoad = () => {
        try {
            const savedState = localStorage.getItem('artifex-sketch');
            if (savedState) {
                const { shapes, history, historyIndex, background } = JSON.parse(savedState);
                setShapes(shapes || []);
                setHistory(history || [{ shapes: [], background: '#FFFFFF' }]);
                setHistoryIndex(historyIndex || 0);
                setCanvasBackground(background || '#FFFFFF');
                setSelectedShapeIds([]);
                showFeedback('Sketch loaded successfully!');
            } else {
                showFeedback('No saved sketch found.');
            }
        } catch (error) {
            console.error('Failed to load sketch:', error);
            showFeedback('Error: Could not load sketch.');
        }
    };

    const handleExport = () => {
        try {
            const originalCanvas = canvasRef.current;
            if (!originalCanvas) return;
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = originalCanvas.width;
            tempCanvas.height = originalCanvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(originalCanvas, 0, 0);

            const dataUrl = tempCanvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = 'artifex-export.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showFeedback('Exported as PNG!');
        } catch (error) {
            console.error('Failed to export canvas:', error);
            showFeedback('Error: Could not export canvas.');
        }
    };
    
    const handleApplyGradientToSelection = () => {
        if (selectedShapeIds.length === 0) return;
        const newGradient = {
            type: 'gradient',
            gradientType: gradientType,
            colors: [gradientColor1, gradientColor2]
        };
        const newShapes = shapes.map(s => {
            if (selectedShapeIds.includes(s.id)) {
                return { ...s, fill: newGradient };
            }
            return s;
        });
        setShapes(newShapes);
        saveState();
    };

    const handleApplyGradientToBackground = () => {
        const newGradient = {
            type: 'gradient',
            gradientType: gradientType,
            colors: [gradientColor1, gradientColor2]
        };
        setCanvasBackground(newGradient);
        saveState();
    };

  // --- API Calls ---
    const handleGeneratePalette = async () => {
    if (!ai) return;
    setIsGeneratingPalette(true);
    setError(null);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Generate a color palette based on the following theme: "${palettePrompt}". Provide 7 hex color codes.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              colors: { type: Type.ARRAY, description: 'An array of 7 hex color codes.', items: { type: Type.STRING } }
            }
          },
        },
      });
      const parsed = JSON.parse(response.text.trim());
      if (parsed.colors && Array.isArray(parsed.colors)) setPalette(parsed.colors);
    } catch (e) {
      console.error(e);
      setError("Couldn't generate palette. Try a different prompt.");
    } finally {
      setIsGeneratingPalette(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!ai || !canvasRef.current) return;
    setLoading(true);
    setLoadingMessage('Enhancing sketch with AI...');
    setError(null);
    setOutput(null);

    try {
      const blob = await getCanvasBlob(canvasRef.current);
      const base64Data = await blobToBase64(blob);

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: 'image/png' } },
            { text: `Style: ${style}. ${prompt}` },
          ],
        },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
      });

      const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!imagePart) throw new Error('No image was generated.');
      
      const generatedBase64 = imagePart.inlineData.data;
      setOutput({ type: 'image', url: `data:image/png;base64,${generatedBase64}`, base64: generatedBase64 });

    } catch (e) {
      console.error(e);
      setError(e.message || 'Error generating image.');
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const handleAnimateImage = async () => {
    if (!ai || !output || output.type !== 'image') return;
    setLoading(true);
    setError(null);

    try {
      setLoadingMessage('Starting video generation...');
      let operation = await ai.models.generateVideos({
        model: 'veo-2.0-generate-001',
        prompt: `Animate this image in a ${style} style. ${prompt}`,
        image: { imageBytes: output.base64, mimeType: 'image/png' },
        config: { numberOfVideos: 1 }
      });
      
      setLoadingMessage('Processing video... this may take minutes.');
      
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        setLoadingMessage('Checking generation status...');
        operation = await ai.operations.getVideosOperation({ operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) throw new Error('No video download link found.');

      setLoadingMessage('Downloading video...');
      const response = await fetch(`${downloadLink}&key=${API_KEY}`);
      if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);

      const videoBlob = await response.blob();
      setOutput({ type: 'video', url: URL.createObjectURL(videoBlob), base64: null });

    } catch (e) {
      console.error(e);
      setError(e.message || 'Error animating image.');
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };
  
  const handleToolSelect = (selectedTool) => {
    setTool(selectedTool);
    if(selectedTool !== 'select' && !shapeTools.includes(selectedTool) && selectedTool !== 'gradient') {
        setSelectedShapeIds([]);
    }
    setIsShapePopoverOpen(false);
  };
  
  const toggleSection = (sectionName) => {
    setOpenSections(prev => ({ ...prev, [sectionName]: !prev[sectionName] }));
  };

  return html`
    <div class="app-container">
      <header>
        <svg class="logo" width="28" height="28" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="logo-a-gradient" x1="50" y1="0" x2="50" y2="100" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#8A5FFB"/>
                    <stop offset="1" stop-color="#4F46E5"/>
                </linearGradient>
                <linearGradient id="logo-stroke-gradient" x1="20" y1="55" x2="80" y2="55" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#34D399"/>
                    <stop offset="1" stop-color="#A7F3D0"/>
                </linearGradient>
            </defs>
            <path d="M50 10L15 90H30L50 40L70 90H85L50 10Z" fill="url(#logo-a-gradient)"/>
            <path d="M25 60C35 55, 65 55, 75 60" stroke="url(#logo-stroke-gradient)" stroke-width="8" stroke-linecap="round"/>
            <circle cx="50" cy="10" r="6" fill="white"/>
            <circle cx="15" cy="90" r="6" fill="white"/>
            <circle cx="85" cy="90" r="6" fill="white"/>
            <circle cx="50" cy="40" r="4" fill="white" fill-opacity="0.8"/>
        </svg>
        <h1>Artifex</h1>
      </header>
      <main class="main-content">
        <div class="left-panel">
          <aside class="vertical-toolbar">
              <button class="tool-button ${tool === 'select' ? 'active' : ''}" onClick=${() => handleToolSelect('select')} aria-label="Select" title="Select (V)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
              </button>
              <button class="tool-button ${tool === 'pencil' ? 'active' : ''}" onClick=${() => handleToolSelect('pencil')} aria-label="Pencil" title="Pencil (B)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
              <button class="tool-button ${tool === 'eraser' ? 'active' : ''}" onClick=${() => handleToolSelect('eraser')} aria-label="Eraser" title="Eraser (E)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21H7Z"/><path d="M22 21H7"/><path d="m5 12 5 5"/></svg>
              </button>
               <button class="tool-button ${tool === 'gradient' ? 'active' : ''}" onClick=${() => handleToolSelect('gradient')} aria-label="Gradient Tool" title="Gradient (G)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="url(#gradient-icon-fill)" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <defs>
                            <linearGradient id="gradient-icon-fill">
                                <stop offset="0%" stop-color="#fff" />
                                <stop offset="100%" stop-color="#888" />
                            </linearGradient>
                        </defs>
                        <circle cx="12" cy="12" r="10" />
                    </svg>
                </button>
              <div class="shape-popover-container" ref=${shapePopoverRef}>
                  <button class="tool-button ${isShapeTool ? 'active' : ''}" onClick=${() => setIsShapePopoverOpen(prev => !prev)} aria-label="Shape Tools" title="Shapes (S)">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                  </button>
                  ${isShapePopoverOpen && html`
                      <div class="shape-popover">
                          <button class="shape-popover-item ${tool === 'line' ? 'active' : ''}" onClick=${() => handleToolSelect('line')} title="Line">
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/></svg>
                          </button>
                           <button class="shape-popover-item ${tool === 'rectangle' ? 'active' : ''}" onClick=${() => handleToolSelect('rectangle')} title="Rectangle">
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="0" ry="0"></rect></svg>
                          </button>
                          <button class="shape-popover-item ${tool === 'circle' ? 'active' : ''}" onClick=${() => handleToolSelect('circle')} title="Circle">
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle></svg>
                          </button>
                          <button class="shape-popover-item ${tool === 'triangle' ? 'active' : ''}" onClick=${() => handleToolSelect('triangle')} title="Triangle">
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L2 22 H22 Z"/></svg>
                          </button>
                          <button class="shape-popover-item ${tool === 'star' ? 'active' : ''}" onClick=${() => handleToolSelect('star')} title="Star">
                               <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                          </button>
                          <button class="shape-popover-item ${tool === 'pentagon' ? 'active' : ''}" onClick=${() => handleToolSelect('pentagon')} title="Pentagon">
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l10 7.2-3.8 11.8H5.8L2 9.2z"/></svg>
                          </button>
                           <button class="shape-popover-item ${tool === 'hexagon' ? 'active' : ''}" onClick=${() => handleToolSelect('hexagon')} title="Hexagon">
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/></svg>
                          </button>
                      </div>
                  `}
              </div>
              <hr />
              <button class="tool-button" onClick=${handleGroup} disabled=${selectedShapeIds.length < 2} aria-label="Group" title="Group (Ctrl+G)">
                   <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
              </button>
              <button class="tool-button" onClick=${handleUngroup} disabled=${selectedShapeIds.length !== 1 || !shapes.find(s => s.id === selectedShapeIds[0] && s.type === 'group')} aria-label="Ungroup" title="Ungroup (Ctrl+Shift+G)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v2"></path><path d="M9 12H5"></path><path d="M12 9V5"></path></svg>
              </button>
              <hr />
              <button class="tool-button" onClick=${handleUndo} disabled=${historyIndex <= 0} aria-label="Undo" title="Undo (Ctrl+Z)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
              </button>
              <button class="tool-button" onClick=${handleRedo} disabled=${historyIndex >= history.length - 1} aria-label="Redo" title="Redo (Ctrl+Y)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 0 9 9 9 9 0 0 0 6-2.3L21 13"/></svg>
              </button>
              <button class="tool-button" onClick=${clearCanvas} disabled=${loading || (shapes.length === 0 && canvasBackground === '#FFFFFF')} aria-label="Clear Canvas" title="Clear Canvas">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
               <hr />
              <button class="tool-button" onClick=${handleSave} aria-label="Save Sketch" title="Save Sketch">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              </button>
              <button class="tool-button" onClick=${handleLoad} aria-label="Load Sketch" title="Load Sketch">
                   <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg>
              </button>
              <button class="tool-button" onClick=${handleExport} aria-label="Export Canvas" title="Export as PNG">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </button>
          </aside>
          <section class="canvas-panel" aria-labelledby="canvas-heading">
              <h2 id="canvas-heading" class="sr-only">Sketchpad</h2>
              <div class="canvas-wrapper">
                <canvas ref=${canvasRef} class="sketch-canvas"></canvas>
                <canvas 
                  ref=${previewCanvasRef} 
                  class="preview-canvas ${cursorStyle}"
                  onMouseDown=${startInteraction}
                  onMouseUp=${endInteraction}
                  onMouseLeave=${endInteraction}
                  onMouseMove=${moveInteraction}
                  onTouchStart=${startInteraction}
                  onTouchEnd=${endInteraction}
                  onTouchMove=${moveInteraction}
                ></canvas>
                ${feedbackMessage && html`<div class="feedback-toast">${feedbackMessage}</div>`}
              </div>
          </section>
        </div>

        <div class="right-panel">
          <section class="panel output-panel" aria-labelledby="output-heading">
              <h2 id="output-heading" class="sr-only">AI Output</h2>
               ${loading && html`
                  <div class="loader-overlay">
                      <div class="spinner"></div>
                      <p>${loadingMessage}</p>
                  </div>
              `}
              ${!output && !loading && html`
                  <div class="output-placeholder">
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
                     <p>Your generated artwork will appear here</p>
                  </div>
              `}
              ${output?.type === 'image' && html`
                  <img src=${output.url} alt="AI generated image" class="output-content" />
              `}
               ${output?.type === 'video' && html`
                  <video src=${output.url} controls autoplay loop class="output-content" />
              `}
               ${output && !loading && html`
                  <div class="output-actions">
                    ${output.type === 'image' && html`
                      <button class="secondary-button" onClick=${handleAnimateImage} disabled=${loading || !ai}>Animate</button>
                    `}
                    <a href=${output.url} download="ai-creation.${output.type === 'image' ? 'png' : 'mp4'}" class="secondary-button" style="text-decoration:none;">Download</a>
                  </div>
              `}
          </section>
          <aside class="inspector-panel" aria-label="Inspector and AI Studio">
              ${error && html`<div class="error-message">${error}</div>`}
              
              <div class="collapsible-section">
                <button class="section-header" onClick=${() => toggleSection('toolOptions')} aria-expanded=${openSections.toolOptions}>
                    <h3>Tool Options</h3>
                    <svg class="chevron-icon ${openSections.toolOptions ? 'open' : ''}" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                <div class="section-content ${openSections.toolOptions ? 'open' : ''}">
                  <div class="inspector-section-content">
                    ${(tool === 'pencil' || tool === 'eraser') && html`
                        <div class="form-group">
                            <label for="brush-size">Brush Size: ${brushSize}</label>
                            <input type="range" id="brush-size" min="1" max="50" value=${brushSize} onInput=${(e) => setBrushSize(e.target.value)} />
                            <label class="color-picker-label" for="color-picker" aria-label="Brush Color Picker" title="Brush Color">
                                <span>Color</span>
                                <div class="color-swatch-preview" style="background-color: ${color};"></div>
                                <input id="color-picker" type="color" value=${color} onInput=${(e) => setColor(e.target.value)} />
                            </label>
                        </div>
                    `}
                    ${isShapeTool && tool !== 'gradient' && html`
                      <div class="form-group">
                        <label>New Shape Appearance</label>
                        <div class="appearance-controls">
                          <label for="fill-color-picker" class="color-picker-label" aria-label="Fill Color Picker" title="Fill Color">
                                <span>Fill</span>
                                <div class="color-swatch-preview" style="background-color: ${fillColor};"></div>
                                <input id="fill-color-picker" type="color" value=${fillColor} onInput=${(e) => setFillColor(e.target.value)} />
                            </label>
                            <label for="stroke-color-picker" class="color-picker-label" aria-label="Stroke Color Picker" title="Stroke Color">
                                <span>Stroke</span>
                                <div class="color-swatch-preview" style="background-color: ${strokeColor};"></div>
                                <input id="stroke-color-picker" type="color" value=${strokeColor} onInput=${(e) => setStrokeColor(e.target.value)} />
                            </label>
                          <div class="range-control">
                            <label for="stroke-width">Stroke Width: ${strokeWidth}</label>
                            <input type="range" id="stroke-width" min="1" max="50" value=${strokeWidth} onInput=${(e) => setStrokeWidth(e.target.value)} />
                          </div>
                        </div>
                      </div>
                    `}
                    ${tool === 'gradient' && html`
                      <div class="form-group">
                          <label>Gradient Options</label>
                          <div class="gradient-type-toggle">
                              <label>
                                  <input type="radio" name="gradientType" value="linear" checked=${gradientType === 'linear'} onChange=${() => setGradientType('linear')} />
                                  <span>Linear</span>
                              </label>
                              <label>
                                  <input type="radio" name="gradientType" value="radial" checked=${gradientType === 'radial'} onChange=${() => setGradientType('radial')} />
                                  <span>Radial</span>
                              </label>
                          </div>
                          <label for="gradient-color-1" class="color-picker-label" aria-label="Gradient Start Color" title="Start Color">
                              <span>Start Color</span>
                              <div class="color-swatch-preview" style="background-color: ${gradientColor1};"></div>
                              <input id="gradient-color-1" type="color" value=${gradientColor1} onInput=${(e) => setGradientColor1(e.target.value)} />
                          </label>
                          <label for="gradient-color-2" class="color-picker-label" aria-label="Gradient End Color" title="End Color">
                              <span>End Color</span>
                              <div class="color-swatch-preview" style="background-color: ${gradientColor2};"></div>
                              <input id="gradient-color-2" type="color" value=${gradientColor2} onInput=${(e) => setGradientColor2(e.target.value)} />
                          </label>
                          <div class="gradient-actions">
                              <button class="secondary-button" onClick=${handleApplyGradientToSelection} disabled=${selectedShapeIds.length === 0}>Apply to Selection</button>
                              <button class="secondary-button" onClick=${handleApplyGradientToBackground}>Apply to Background</button>
                          </div>
                      </div>
                    `}
                  </div>
                </div>
              </div>

              ${selectedShapeIds.length > 0 && html`
                <div class="collapsible-section">
                    <button class="section-header" onClick=${() => toggleSection('shapeProperties')} aria-expanded=${openSections.shapeProperties}>
                        <h3>Shape Properties</h3>
                        <svg class="chevron-icon ${openSections.shapeProperties ? 'open' : ''}" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                    <div class="section-content ${openSections.shapeProperties ? 'open' : ''}">
                        <div class="inspector-section-content">
                            <div class="form-group">
                                <label>Appearance</label>
                                <div class="appearance-controls">
                                <label for="selected-fill-color" class="color-picker-label" aria-label="Fill Color Picker" title="Fill Color">
                                        <span>Fill</span>
                                        <div class="color-swatch-preview" style="background-color: ${fillColor};"></div>
                                        <input id="selected-fill-color" type="color" value=${fillColor} onInput=${(e) => {setFillColor(e.target.value); handleShapeControlChange('fill', null, e.target.value)}} onMouseUp=${() => saveState()} />
                                    </label>
                                    <label for="selected-stroke-color" class="color-picker-label" aria-label="Stroke Color Picker" title="Stroke Color">
                                        <span>Stroke</span>
                                        <div class="color-swatch-preview" style="background-color: ${strokeColor};"></div>
                                        <input id="selected-stroke-color" type="color" value=${strokeColor} onInput=${(e) => {setStrokeColor(e.target.value); handleShapeControlChange('stroke', 'color', e.target.value)}} onMouseUp=${() => saveState()} />
                                    </label>
                                <div class="range-control">
                                    <label for="selected-stroke-width">Stroke Width: ${strokeWidth}</label>
                                    <input type="range" id="selected-stroke-width" min="1" max="50" value=${strokeWidth} onInput=${(e) => {setStrokeWidth(e.target.value); handleShapeControlChange('stroke', 'width', Number(e.target.value))}} onMouseUp=${() => saveState()}/>
                                </div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label for="rotation-input">Rotation: ${Math.round((selectedShapes[0]?.rotation || 0) * 180 / Math.PI)}°</label>
                                <input 
                                    type="range" 
                                    id="rotation-input" 
                                    min="0" 
                                    max="360" 
                                    value=${Math.round((selectedShapes[0]?.rotation || 0) * 180 / Math.PI)} 
                                    onInput=${(e) => handleShapeControlChange('rotation', null, Number(e.target.value) * Math.PI / 180)}
                                    onMouseUp=${() => saveState()}
                                />
                            </div>
                            ${selectedShapeIds.length > 1 && html`
                                <div class="form-group">
                                    <label>Alignment</label>
                                    <div class="alignment-controls">
                                        <button onClick=${() => handleAlignment('left')} title="Align Left"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="3" x2="10" y2="21"></line><rect x="4" y="7" width="4" height="10"></rect><rect x="12" y="5" width="4" height="14"></rect></svg></button>
                                        <button onClick=${() => handleAlignment('center')} title="Align Center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"></line><rect x="4" y="7" width="4" height="10"></rect><rect x="16" y="5" width="4" height="14"></rect></svg></button>
                                        <button onClick=${() => handleAlignment('right')} title="Align Right"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="14" y1="3" x2="14" y2="21"></line><rect x="16" y="7" width="4" height="10"></rect><rect x="8" y="5" width="4" height="14"></rect></svg></button>
                                        <button onClick=${() => handleAlignment('top')} title="Align Top"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="10" x2="21" y2="10"></line><rect x="7" y="4" width="10" height="4"></rect><rect x="5" y="12" width="14" height="4"></rect></svg></button>
                                        <button onClick=${() => handleAlignment('middle')} title="Align Middle"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><rect x="7" y="4" width="10" height="4"></rect><rect x="5" y="16" width="14" height="4"></rect></svg></button>
                                        <button onClick=${() => handleAlignment('bottom')} title="Align Bottom"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="14" x2="21" y2="14"></line><rect x="7" y="16" width="10" height="4"></rect><rect x="5" y="8" width="14" height="4"></rect></svg></button>
                                    </div>
                                </div>
                            `}
                        </div>
                    </div>
                </div>
              `}

              <div class="collapsible-section">
                <button class="section-header" onClick=${() => toggleSection('aiStudio')} aria-expanded=${openSections.aiStudio}>
                  <h3>AI Studio</h3>
                  <svg class="chevron-icon ${openSections.aiStudio ? 'open' : ''}" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                <div class="section-content ${openSections.aiStudio ? 'open' : ''}">
                  <div class="inspector-section-content">
                    <div class="form-group">
                        <label for="palette-prompt">AI Color Palette</label>
                        <div class="palette-generator">
                            <input id="palette-prompt" type="text" placeholder="e.g. Sunset over a beach" value=${palettePrompt} onInput=${(e) => setPalettePrompt(e.target.value)} />
                            <button onClick=${handleGeneratePalette} disabled=${isGeneratingPalette || !ai}>${isGeneratingPalette ? '...' : '🎨'}</button>
                        </div>
                        <div class="palette-swatches">
                            ${palette.map(c => html`<button class="swatch" style="background-color: ${c}" onClick=${() => tool === 'pencil' || tool === 'eraser' ? setColor(c) : setFillColor(c)} aria-label="Set color to ${c}" title=${c}></button>`)}
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="prompt-input">Prompt</label>
                        <textarea id="prompt-input" class="prompt-textarea" placeholder="e.g., A robot holding a red skateboard" value=${prompt} onInput=${(e) => setPrompt(e.target.value)}></textarea>
                    </div>

                    <div class="form-group">
                        <label for="style-select">Style</label>
                        <select id="style-select" class="style-select" value=${style} onChange=${(e) => setStyle(e.target.value)}>
                            ${['Realistic', 'Cartoon', 'Anime', '3D Render', 'Abstract', 'Watercolor', 'Pixel Art', 'Line Art', 'Gouache'].map(s => html`<option>${s}</option>`)}
                        </select>
                    </div>
                    <div class="action-buttons">
                      <button class="primary-button" onClick=${handleGenerateImage} disabled=${loading || !ai}>
                        Generate Image
                      </button>
                    </div>
                  </div>
                </div>
              </div>
          </aside>
        </div>
      </main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root'));