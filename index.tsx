/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'preact';
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { html } from 'htm/preact';
import { GoogleGenAI, Modality } from '@google/genai';

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
      // FIX: Cast reader.result to string. `readAsDataURL` ensures it's a string.
      const base64data = reader.result as string;
      // The Gemini API expects just the Base64 content, not the data URI prefix
      resolve(base64data.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};


// --- Main App Component ---
function App() {
  const [ai, setAi] = useState(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const isDrawing = useRef(false);

  // --- State ---
  const [tool, setTool] = useState('pencil'); // 'pencil' or 'eraser'
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [prompt, setPrompt] = useState('A cute, fluffy cat wearing a wizard hat.');
  const [style, setStyle] = useState('Cartoon');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [output, setOutput] = useState(null); // { type: 'image' | 'video', url: string, base64: string }

  // --- Initialize AI Client ---
  useEffect(() => {
    try {
      if (!API_KEY) {
        throw new Error("API_KEY environment variable not set.");
      }
      setAi(new GoogleGenAI({ apiKey: API_KEY }));
    } catch (e) {
      console.error(e);
      setError('Failed to initialize AI client. Please check your API key.');
    }
  }, []);

  // --- Canvas Setup ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
        const parent = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = parent.clientWidth * dpr;
        canvas.height = parent.clientHeight * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctxRef.current = ctx;
        clearCanvas();
    };

    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas.parentElement);
    resizeCanvas();

    return () => observer.disconnect();
  }, []);

  // --- Drawing Logic ---
  const getCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = useCallback((e) => {
    e.preventDefault();
    isDrawing.current = true;
    const { x, y } = getCoords(e);
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(x, y);
  }, []);

  const stopDrawing = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    ctxRef.current.closePath();
  }, []);

  const draw = useCallback((e) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const { x, y } = getCoords(e);
    const ctx = ctxRef.current;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    
    // For eraser on white background, we need to fake it if there's transparency
    if (tool === 'eraser') {
      ctx.strokeStyle = "rgba(255,255,255,1)";
      ctx.globalCompositeOperation="destination-out";
    } else {
      ctx.strokeStyle = color;
      ctx.globalCompositeOperation="source-over";
    }

    ctx.lineTo(x, y);
    ctx.stroke();
  }, [tool, color, brushSize]);

  const clearCanvas = () => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if(ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };
  
  // --- API Calls ---
  const handleGenerateImage = async () => {
    if (!ai || !canvasRef.current) return;
    setLoading(true);
    setLoadingMessage('Enhancing sketch with AI...');
    setError(null);
    setOutput(null);

    try {
      const blob = await getCanvasBlob(canvasRef.current);
      const base64Data = await blobToBase64(blob);

      const fullPrompt = `Style: ${style}. ${prompt}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: 'image/png' } },
            { text: fullPrompt },
          ],
        },
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
      });

      const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
      if (!imagePart) {
        throw new Error('No image was generated. The model may have refused the prompt.');
      }
      
      const generatedBase64 = imagePart.inlineData.data;
      const imageUrl = `data:image/png;base64,${generatedBase64}`;
      setOutput({ type: 'image', url: imageUrl, base64: generatedBase64 });

    } catch (e) {
      console.error(e);
      setError(e.message || 'An unexpected error occurred while generating the image.');
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
      
      setLoadingMessage('Processing video... this may take a few minutes.');
      
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        setLoadingMessage('Checking generation status...');
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) {
        throw new Error('Video generation finished, but no download link was found.');
      }

      setLoadingMessage('Downloading video...');
      const response = await fetch(`${downloadLink}&key=${API_KEY}`);
      if (!response.ok) {
        throw new Error(`Failed to download video: ${response.statusText}`);
      }

      const videoBlob = await response.blob();
      const videoUrl = URL.createObjectURL(videoBlob);
      setOutput({ type: 'video', url: videoUrl, base64: null });

    } catch (e) {
      console.error(e);
      setError(e.message || 'An unexpected error occurred while animating the image.');
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  return html`
    <div class="app-container">
      <header>
        <svg class="logo" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L9 9l-7 2 7 2 2 7 2-7 7-2-7-2-3-7z"/>
            <path d="M12 22l-2-4-4-1 4-1 2-4 2 4 4 1-4 1-2 4z"/>
        </svg>
        <h1>Artifex</h1>
      </header>
      <main class="main-content">
        <section class="panel controls-panel" aria-labelledby="controls-heading">
            <h2 id="controls-heading">Creative Tools</h2>
            
            ${error && html`<div class="error-message">${error}</div>`}

            <div class="form-group">
                <label>Toolbar</label>
                <div class="toolbar">
                    <button class="tool-button ${tool === 'pencil' ? 'active' : ''}" onClick=${() => setTool('pencil')} aria-label="Pencil">
                        ✏️ Pencil
                    </button>
                    <button class="tool-button ${tool === 'eraser' ? 'active' : ''}" onClick=${() => setTool('eraser')} aria-label="Eraser">
                        🧼 Eraser
                    </button>
                     <label class="tool-button" for="color-picker" aria-label="Color Picker">
                        🎨 Color
                        <input id="color-picker" type="color" value=${color} onInput=${(e) => setColor(e.target.value)} />
                    </label>
                </div>
                 <label for="brush-size">Brush Size: ${brushSize}</label>
                 <input type="range" id="brush-size" min="1" max="50" value=${brushSize} onInput=${(e) => setBrushSize(e.target.value)} />
            </div>

            <div class="form-group">
                <label for="prompt-input">Prompt</label>
                <textarea id="prompt-input" class="prompt-textarea" placeholder="e.g., A robot holding a red skateboard" value=${prompt} onInput=${(e) => setPrompt(e.target.value)}></textarea>
            </div>

            <div class="form-group">
                <label for="style-select">Style</label>
                <select id="style-select" class="style-select" value=${style} onChange=${(e) => setStyle(e.target.value)}>
                    <option>Realistic</option>
                    <option>Cartoon</option>
                    <option>Anime</option>
                    <option>3D Render</option>
                    <option>Abstract</option>
                    <option>Watercolor</option>
                </select>
            </div>
            
            <div class="action-buttons">
              <button class="primary-button" onClick=${handleGenerateImage} disabled=${loading || !ai}>
                Generate Image
              </button>
              <button class="secondary-button" onClick=${clearCanvas} disabled=${loading}>
                Clear Canvas
              </button>
            </div>
        </section>

        <section class="panel canvas-panel" aria-labelledby="canvas-heading">
            <h2 id="canvas-heading" class="sr-only">Sketchpad</h2>
            <canvas 
              ref=${canvasRef} 
              class="sketch-canvas"
              onMouseDown=${startDrawing}
              onMouseUp=${stopDrawing}
              onMouseLeave=${stopDrawing}
              onMouseMove=${draw}
              onTouchStart=${startDrawing}
              onTouchEnd=${stopDrawing}
              onTouchMove=${draw}
            ></canvas>
        </section>

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
      </main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root'));