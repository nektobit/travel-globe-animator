import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import { ExportProgress, ExportResult } from '../models/types';

export interface ExportRenderer {
  setRenderSize(width: number, height: number): void;
  restoreRenderSize(): void;
  setProgress(progress: number): void;
  renderFrame(): void;
  getCanvas(): HTMLCanvasElement;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  async export4kVideo(
    renderer: ExportRenderer,
    durationSec: number,
    onProgress: (progress: ExportProgress) => void
  ): Promise<ExportResult> {
    const width = 3840;
    const height = 2160;
    const fps = 30;
    const totalFrames = Math.max(2, Math.round(durationSec * fps));

    renderer.setRenderSize(width, height);

    try {
      if (this.canUseWebCodecs()) {
        return await this.exportWithWebCodecs(renderer, width, height, fps, totalFrames, onProgress);
      }

      if (typeof MediaRecorder !== 'undefined') {
        const fallbackVideo = await this.exportWithMediaRecorder(
          renderer,
          width,
          height,
          fps,
          totalFrames,
          onProgress
        );

        return {
          ...fallbackVideo,
          warning:
            'WebCodecs недоступен: применён fallback через MediaRecorder. Результат зависит от мощности ПК и может быть не frame-perfect.'
        };
      }

      const zipResult = await this.exportAsPngZip(renderer, totalFrames, onProgress);
      return {
        ...zipResult,
        warning:
          'WebCodecs и MediaRecorder недоступны: экспортирована PNG-последовательность в ZIP (каждый 5-й кадр).'
      };
    } finally {
      renderer.restoreRenderSize();
      renderer.setProgress(0);
      renderer.renderFrame();
    }
  }

  private canUseWebCodecs(): boolean {
    return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  }

  private async exportWithWebCodecs(
    renderer: ExportRenderer,
    width: number,
    height: number,
    fps: number,
    totalFrames: number,
    onProgress: (progress: ExportProgress) => void
  ): Promise<ExportResult> {
    const config: VideoEncoderConfig = {
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 16_000_000,
      framerate: fps
    };

    const supported = await VideoEncoder.isConfigSupported(config);
    if (!supported.supported) {
      throw new Error('WebCodecs есть, но VP9-конфигурация не поддерживается этим браузером.');
    }

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'V_VP9',
        width,
        height,
        frameRate: fps
      }
    });

    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        throw error;
      }
    });

    encoder.configure(config);

    const canvas = renderer.getCanvas();

    for (let i = 0; i < totalFrames; i += 1) {
      const progress = i / (totalFrames - 1);
      renderer.setProgress(progress);
      renderer.renderFrame();

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i / fps) * 1_000_000),
        duration: Math.round((1 / fps) * 1_000_000)
      });

      encoder.encode(frame, { keyFrame: i % fps === 0 });
      frame.close();

      onProgress({ frame: i + 1, totalFrames });
      if (i % 5 === 0) {
        await this.nextMicrotask();
      }
    }

    await encoder.flush();
    encoder.close();
    muxer.finalize();

    return {
      blob: new Blob([target.buffer], { type: 'video/webm' }),
      fileName: `travel-route-4k-${Date.now()}.webm`
    };
  }

  private async exportWithMediaRecorder(
    renderer: ExportRenderer,
    width: number,
    height: number,
    fps: number,
    totalFrames: number,
    onProgress: (progress: ExportProgress) => void
  ): Promise<ExportResult> {
    const canvas = renderer.getCanvas();
    const stream = canvas.captureStream(fps);
    const mimeType = this.pickMediaRecorderMimeType();
    const chunks: BlobPart[] = [];

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    const stopPromise = new Promise<void>((resolve, reject) => {
      recorder.onerror = () => reject(new Error('MediaRecorder export failed'));
      recorder.onstop = () => resolve();
    });

    recorder.start();

    for (let i = 0; i < totalFrames; i += 1) {
      renderer.setProgress(i / (totalFrames - 1));
      renderer.renderFrame();
      onProgress({ frame: i + 1, totalFrames });
      await this.sleep(1000 / fps);
    }

    recorder.stop();
    await stopPromise;
    stream.getTracks().forEach((track) => track.stop());

    return {
      blob: new Blob(chunks, { type: mimeType ?? 'video/webm' }),
      fileName: `travel-route-fallback-${Date.now()}.webm`
    };
  }

  private async exportAsPngZip(
    renderer: ExportRenderer,
    totalFrames: number,
    onProgress: (progress: ExportProgress) => void
  ): Promise<ExportResult> {
    const zip = new JSZip();
    const step = 5;
    let exported = 0;

    for (let i = 0; i < totalFrames; i += 1) {
      renderer.setProgress(i / (totalFrames - 1));
      renderer.renderFrame();
      onProgress({ frame: i + 1, totalFrames });

      if (i % step !== 0 && i !== totalFrames - 1) {
        continue;
      }

      const blob = await this.canvasToPng(renderer.getCanvas());
      const frameName = `frame-${String(exported).padStart(5, '0')}.png`;
      zip.file(frameName, blob);
      exported += 1;
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    return {
      blob,
      fileName: `travel-route-frames-${Date.now()}.zip`
    };
  }

  private pickMediaRecorderMimeType(): string | null {
    const options = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const supported = options.find((option) => MediaRecorder.isTypeSupported(option));
    return supported ?? null;
  }

  private canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG conversion failed'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }

  private async nextMicrotask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
