import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  signal
} from '@angular/core';
import * as Cesium from 'cesium';
import { RoutePoint } from '../models/types';
import { routeToCartesianHeightMeters } from '../utils/route-math';

@Component({
  selector: 'app-globe-view',
  imports: [],
  templateUrl: './globe-view.component.html',
  styleUrl: './globe-view.component.scss'
})
export class GlobeViewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('container', { static: true })
  private readonly containerRef!: ElementRef<HTMLDivElement>;

  private viewer: Cesium.Viewer | null = null;
  private routePoints: RoutePoint[] = [];
  private routeCartesians: Cesium.Cartesian3[] = [];

  private fullRouteEntity: Cesium.Entity | null = null;
  private activeRouteEntity: Cesium.Entity | null = null;
  private planeEntity: Cesium.Entity | null = null;

  private readonly progress = signal(0);
  private previousRenderState: {
    width: string;
    height: string;
    position: string;
    left: string;
    top: string;
    zIndex: string;
    resolutionScale: number;
  } | null = null;

  constructor(private readonly ngZone: NgZone) {}

  ngAfterViewInit(): void {
    this.initCesium();
  }

  ngOnDestroy(): void {
    this.setInteractionEnabled(false);
    this.viewer?.destroy();
    this.viewer = null;
  }

  setRoute(routePoints: RoutePoint[]): void {
    this.routePoints = routePoints;
    this.routeCartesians = routePoints.map((point) =>
      Cesium.Cartesian3.fromDegrees(point.lng, point.lat, routeToCartesianHeightMeters(point))
    );

    if (!this.viewer) {
      return;
    }

    this.removeEntities();

    if (!this.routeCartesians.length) {
      this.setInteractionEnabled(false);
      this.viewer.scene.render();
      return;
    }

    this.fullRouteEntity = this.viewer.entities.add({
      polyline: {
        positions: this.routeCartesians,
        width: 2,
        material: Cesium.Color.fromCssColorString('#7ca1cc').withAlpha(0.35)
      }
    });

    this.activeRouteEntity = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => this.visibleRoutePositions(), false),
        width: 4,
        material: Cesium.Color.fromCssColorString('#f7f4ea')
      }
    });

    this.planeEntity = this.viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(() => this.currentPlanePosition(), false),
      billboard: {
        image: makePlaneSvgDataUrl(),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        width: 42,
        height: 42,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });

    this.setProgress(0);
    this.setInteractionEnabled(true);
  }

  setProgress(progress: number): void {
    this.progress.set(Math.min(1, Math.max(0, progress)));
    this.viewer?.scene.render();
  }

  fitToRoute(): void {
    if (!this.viewer || !this.routeCartesians.length) {
      return;
    }

    const sphere = Cesium.BoundingSphere.fromPoints(this.routeCartesians);
    this.viewer.camera.viewBoundingSphere(
      sphere,
      new Cesium.HeadingPitchRange(0, -0.7, sphere.radius * 2.0)
    );
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    this.viewer.scene.render();
  }

  setRenderSize(width: number, height: number): void {
    if (!this.viewer) {
      return;
    }

    const container = this.containerRef.nativeElement;

    if (!this.previousRenderState) {
      this.previousRenderState = {
        width: container.style.width,
        height: container.style.height,
        position: container.style.position,
        left: container.style.left,
        top: container.style.top,
        zIndex: container.style.zIndex,
        resolutionScale: this.viewer.resolutionScale
      };
    }

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.zIndex = '-1';

    this.viewer.useBrowserRecommendedResolution = false;
    this.viewer.resolutionScale = 1 / window.devicePixelRatio;
    this.viewer.resize();
    this.viewer.scene.render();
  }

  restoreRenderSize(): void {
    if (!this.viewer || !this.previousRenderState) {
      return;
    }

    const container = this.containerRef.nativeElement;
    container.style.width = this.previousRenderState.width;
    container.style.height = this.previousRenderState.height;
    container.style.position = this.previousRenderState.position;
    container.style.left = this.previousRenderState.left;
    container.style.top = this.previousRenderState.top;
    container.style.zIndex = this.previousRenderState.zIndex;

    this.viewer.resolutionScale = this.previousRenderState.resolutionScale;
    this.viewer.useBrowserRecommendedResolution = true;
    this.viewer.resize();
    this.viewer.scene.render();
    this.previousRenderState = null;
  }

  renderFrame(): void {
    this.viewer?.scene.render();
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.viewer) {
      throw new Error('Cesium Viewer is not initialized');
    }

    return this.viewer.scene.canvas;
  }

  private initCesium(): void {
    this.ngZone.runOutsideAngular(() => {
      const imageryProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: new Cesium.Credit('© OpenStreetMap contributors')
      });

      this.viewer = new Cesium.Viewer(this.containerRef.nativeElement, {
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        timeline: false,
        homeButton: false,
        fullscreenButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        selectionIndicator: false,
        infoBox: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Number.POSITIVE_INFINITY,
        terrain: undefined
      });

      this.viewer.imageryLayers.removeAll();
      this.viewer.imageryLayers.addImageryProvider(imageryProvider);
      this.viewer.scene.globe.showGroundAtmosphere = true;
      const cameraController = this.viewer.scene.screenSpaceCameraController;
      cameraController.enableInputs = false;
      cameraController.enableRotate = false;
      cameraController.enableTranslate = false;
      cameraController.enableZoom = false;
      cameraController.enableTilt = false;
      cameraController.enableLook = false;
      cameraController.inertiaSpin = 0;
      cameraController.inertiaTranslate = 0;
      cameraController.inertiaZoom = 0;
      if (this.viewer.scene.skyAtmosphere) {
        this.viewer.scene.skyAtmosphere.hueShift = 0.08;
        this.viewer.scene.skyAtmosphere.saturationShift = 0.05;
      }
      this.viewer.clock.clockStep = Cesium.ClockStep.TICK_DEPENDENT;
      this.viewer.clock.canAnimate = false;
      this.viewer.clock.multiplier = 0;
      this.viewer.clock.shouldAnimate = false;
      this.viewer.camera.cancelFlight();
      this.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(10, 22, 22_000_000)
      });
      this.setInteractionEnabled(false);
      this.viewer.scene.render();
    });
  }

  private setInteractionEnabled(enabled: boolean): void {
    if (!this.viewer) {
      return;
    }

    const cameraController = this.viewer.scene.screenSpaceCameraController;
    cameraController.enableInputs = enabled;
    cameraController.enableRotate = enabled;
    cameraController.enableTranslate = enabled;
    cameraController.enableZoom = enabled;
    cameraController.enableTilt = enabled;
    cameraController.enableLook = enabled;
    cameraController.inertiaSpin = 0;
    cameraController.inertiaTranslate = 0;
    cameraController.inertiaZoom = 0;
  }

  private removeEntities(): void {
    if (!this.viewer) {
      return;
    }

    if (this.fullRouteEntity) {
      this.viewer.entities.remove(this.fullRouteEntity);
      this.fullRouteEntity = null;
    }

    if (this.activeRouteEntity) {
      this.viewer.entities.remove(this.activeRouteEntity);
      this.activeRouteEntity = null;
    }

    if (this.planeEntity) {
      this.viewer.entities.remove(this.planeEntity);
      this.planeEntity = null;
    }
  }

  private visibleRoutePositions(): Cesium.Cartesian3[] {
    if (!this.routeCartesians.length) {
      return [];
    }

    const index = Math.max(1, Math.floor(this.progress() * (this.routeCartesians.length - 1)) + 1);
    return this.routeCartesians.slice(0, index);
  }

  private currentPlanePosition(): Cesium.Cartesian3 {
    if (!this.routeCartesians.length) {
      return Cesium.Cartesian3.ZERO;
    }

    const index = Math.min(
      this.routeCartesians.length - 1,
      Math.round(this.progress() * (this.routeCartesians.length - 1))
    );
    return this.routeCartesians[index];
  }
}

function makePlaneSvgDataUrl(): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <circle cx="64" cy="64" r="58" fill="#102138" stroke="#f7f4ea" stroke-width="8" />
      <path d="M20 66l74-30 14 14-46 16 20 22-11 11-30-18-15 5z" fill="#f7f4ea" />
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
