"use client";
import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import MyRoom from "@/components/3D/components/MyRoom";
// import MyRoomAntique from "@/components/MyRoomAntique";
import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Center, OrbitControls, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import CanvasLoader from "../../3D/helpers/CanvasLoader";
import LightHelper from "../../3D/helpers/LightHelper";
import CameraAnimator from "@/components/3D/helpers/CameraAnimator";
import { OrbitControls as OrbitControlsProps } from "three-stdlib";
import SteamRibbon from "@/components/3D/components/SteamRibbon";
import { Leva, useControls, button, levaStore } from "leva";
import { MyRoomHandle } from "@/components/3D/components/MyRoom";
import { useDarkMode } from "../context/DarkModeContext";
import { useTranslation } from "react-i18next";
import {
  InitialInvalidate,
  InvalidateOnChange,
} from "@/components/3D/helpers/DemandFrameHelpers";
import SceneVisibilityTracker, {
  type SceneVisibility,
} from "@/components/3D/helpers/SceneVisibilityTracker";
import { isLowGpuTier, useGPUTier } from "@/components/3D/helpers/useGPUTier";
import LowGpuNoticeModal from "@/components/react/sections/LowGpuNoticeModal";

// import { CameraToObjectRay } from "@/components/3D/helpers/CameraToObjectRay";
// import { ObjectCenterMarker } from "@/components/3D/helpers/ObjectCenterMarker";

const WorkRoom3D = () => {
  const [animateCamera, setAnimateCamera] = useState(false);
  const [resetCameraCount, setResetCameraCount] = useState(0);
  const [finishedCameraAnimating, setFinishedCameraAnimating] = useState(false);
  const controlsRef = useRef<OrbitControlsProps>(null);
  const screenRef = useRef<MyRoomHandle>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null!);
  const scaleLevel = 1 / 0.085;
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [isSectionVisible, setIsSectionVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [cupInView, setCupInView] = useState(true);
  const [wallDecorInView, setWallDecorInView] = useState(false);
  const { isDark, toggleDarkMode } = useDarkMode();
  const gpuTier = useGPUTier();
  const lowGpuTier = isLowGpuTier(gpuTier);

  const handleVisibilityChange = useCallback((visibility: SceneVisibility) => {
    setCupInView(visibility.cupInView);
    setWallDecorInView(visibility.wallDecorInView);
  }, []);

  const steamVisible =
    isSectionVisible && !isMobile && !prefersReducedMotion && cupInView;
  const steamAnimating = steamVisible && !lowGpuTier;

  const defaultCameraFov = isMobile ? 70 : 60;

  const initialCameraPosition = useMemo(
    () =>
      new THREE.Vector3(
        3.5 * scaleLevel,
        2.9 * scaleLevel,
        3.0 * scaleLevel
      ),
    [scaleLevel]
  );
  const initialControlsTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const { t } = useTranslation("");
  const [lightHelperLabel, setLightHelperLabel] = useState(t("workroom3D-showLightRays"));
  const [viewLaptopLabel, setViewLaptopLabel] = useState(t("workroom3D-viewlaptop"));
  const [toggleDarkModeLabel, setToggleDarkModeLabel] = useState(t("workroom3D-toggleDarkMode"));
  const [zoomLabel, setZoomLabel] = useState(t("workroom3D-zoom"));
  const [helpersLabel, setHelpersLabel] = useState(t("workroom3D-helpers"));
  const [resetCameraLabel, setResetCameraLabel] = useState(
    t("workroom3D-resetCamera")
  );
  const [castShadowsLabel, setCastShadowsLabel] = useState(
    t("workroom3D-castShadows")
  );
  const [showGpuNotice, setShowGpuNotice] = useState(false);
  const gpuNoticeHandledRef = useRef(false);
  const showLightHelpersRef = useRef(false);
  
  useEffect(() => {
    const mobileMq = window.matchMedia("(max-width: 767px)");
    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncMedia = () => {
      setIsMobile(mobileMq.matches);
      setPrefersReducedMotion(motionMq.matches);
    };

    syncMedia();
    mobileMq.addEventListener("change", syncMedia);
    motionMq.addEventListener("change", syncMedia);

    return () => {
      mobileMq.removeEventListener("change", syncMedia);
      motionMq.removeEventListener("change", syncMedia);
    };
  }, []);

  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsSectionVisible(entry.isIntersecting),
      { threshold: 0.15 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setLightHelperLabel(t("workroom3D-showLightRays"));
    setViewLaptopLabel(t("workroom3D-viewlaptop"));
    setToggleDarkModeLabel(t("workroom3D-toggleDarkMode"));
    setZoomLabel(t("workroom3D-zoom"));
    setHelpersLabel(t("workroom3D-helpers"));
    setResetCameraLabel(t("workroom3D-resetCamera"));
    setCastShadowsLabel(t("workroom3D-castShadows"));
  }, [t]);

  // 🛠️ Panel toggle
  const { zoom } = useControls(
    zoomLabel,
    {
      zoom: {
        value: defaultCameraFov,
        min: 10,
        max: 100,
        step: 1,
        label: "Camera FOV",
      },
    },
    {
      collapsed: isMobile,
    }
  );

  const resetCamera = useCallback(() => {
    setResetCameraCount((n) => n + 1);
    levaStore.set({ [`${zoomLabel}.zoom`]: defaultCameraFov }, true);
    if (cameraRef.current) {
      cameraRef.current.fov = defaultCameraFov;
      cameraRef.current.updateProjectionMatrix();
    }
  }, [defaultCameraFov, zoomLabel]);

  const handleToggleDarkMode = useCallback(() => {
    if (showLightHelpersRef.current) {
      levaStore.set({ [`${helpersLabel}.showLightHelpers`]: false }, true);
    }
    toggleDarkMode();
  }, [helpersLabel, toggleDarkMode]);

  const { showLightHelpers, castShadows } = useControls(
    helpersLabel,
    {
      [viewLaptopLabel]: button(() => setAnimateCamera(true)),
      [resetCameraLabel]: button(resetCamera),
      [toggleDarkModeLabel]: button(handleToggleDarkMode),
      showLightHelpers: {
        value: false,
        label: lightHelperLabel,
      },
      castShadows: {
        value: true,
        label: castShadowsLabel,
      },
    },
    {
      collapsed: isMobile,
    }
  ) as { showLightHelpers: boolean; castShadows: boolean };

  useEffect(() => {
    showLightHelpersRef.current = showLightHelpers;
  }, [showLightHelpers]);

  useEffect(() => {
    if (!lowGpuTier || gpuNoticeHandledRef.current) return;

    gpuNoticeHandledRef.current = true;
    levaStore.set({ [`${helpersLabel}.castShadows`]: false }, true);
    setShowGpuNotice(true);
  }, [lowGpuTier, helpersLabel]);

  useEffect(() => {
    if (cameraRef.current) {
      cameraRef.current.fov = zoom;
      cameraRef.current.updateProjectionMatrix();
    }
  }, [zoom]);

  // Compute the mesh ref from your MyRoom component once it's available
  // const screenMesh = screenRef.current?.screen;

  // Ref for screen mesh
  // const targetScreenRef = useMemo(() => {
  //   return screenMesh ? { current: screenMesh } : null;
  // }, [screenMesh]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-100 to-red-50 relative dark:from-[#221c1c] dark:via-[#171d2d] dark:to-[#040211] dark:text-white -mt-1">
      <div className="flex justify-center items-center text-4xl md:text-6xl font-bold font-[--font-tai-heritage-pro]">
        {t("workroom3D-header")}
      </div>
      {/* Leva panel */}
      <div className="absolute top-23 left-5 z-30">
        <Leva titleBar={true} fill />
      </div>

      <LowGpuNoticeModal
        open={showGpuNotice}
        onClose={() => setShowGpuNotice(false)}
      />

      {/* Canvas  */}
      <div
        ref={canvasContainerRef}
        className="h-[calc(100vh-36px)] md:h-[calc(100vh-60px)] relative z-0"
      >
        <Canvas
          frameloop="demand"
          shadows={castShadows}
          camera={{
            position: [3.5 * scaleLevel, 2.9 * scaleLevel, 3.0 * scaleLevel],
            fov: zoom,
          }}
          onCreated={({ gl, camera }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.outputColorSpace = THREE.SRGBColorSpace; // updated from outputEncoding
            cameraRef.current = camera as THREE.PerspectiveCamera;
          }}
        >
          <InitialInvalidate />
          <InvalidateOnChange
            deps={[
              zoom,
              showLightHelpers,
              isSectionVisible,
              steamVisible,
              steamAnimating,
              cupInView,
              wallDecorInView,
              isDark,
              lowGpuTier,
              castShadows,
            ]}
          />
          <SceneVisibilityTracker
            roomRef={screenRef}
            onVisibilityChange={handleVisibilityChange}
          />
          {/* <Environment preset="sunset" background={false} far={100} /> */}

          {/* Lighting */}
          <ambientLight intensity={1.1} color={0xffffff} />
          <LightHelper
            showHelpers={showLightHelpers}
            castShadows={castShadows}
          />

          {/* Main scene */}
          <Suspense fallback={<CanvasLoader />}>
            {/* Render debug components only when targetScreenRef is ready */}
            {/* {targetScreenRef && (
              <>
                <CameraToObjectRay targetRef={targetScreenRef} />
                <ObjectCenterMarker targetRef={targetScreenRef} />
              </>
            )} */}
            <CameraAnimator
              trigger={animateCamera}
              resetCount={resetCameraCount}
              initialCameraPosition={initialCameraPosition}
              initialControlsTarget={initialControlsTarget}
              setCamera={setAnimateCamera}
              setFinishedCameraAnimating={setFinishedCameraAnimating}
              controlsRef={controlsRef}
              screenRef={screenRef}
            />
            <Center>
              <group scale={2} position={[0, -3, 0]} rotation={[0, -0.1, 0]}>
                <MyRoom
                  ref={screenRef}
                  setCamera={setAnimateCamera}
                  isCameraAnimating={animateCamera}
                  finishedCameraAnimating={finishedCameraAnimating}
                  sceneEffectsActive={steamVisible}
                  showWallHtml={wallDecorInView}
                />
              </group>
            </Center>
          </Suspense>

          {/* Soft contact shadow under the room */}
          <ContactShadows
            position={[0, -35, 0]} // or even -16
            opacity={0.3}
            scale={80} // match X/Z of model size
            blur={1.5}
            far={60} // must cover model height
          />

          {/* Cup's steam — desktop only, when section is visible */}
          {steamVisible && (
            <SteamRibbon
              active={steamAnimating}
              position={[
                0.02 * scaleLevel,
                -0.65 * scaleLevel,
                -0.55 * scaleLevel,
              ]}
            />
          )}

          {/* Rotation and Zoom controls */}
          <OrbitControls
            ref={controlsRef}
            maxPolarAngle={Math.PI / 2}
            enableZoom={false}
          />
        </Canvas>
      </div>
    </div>
  );
};

export default WorkRoom3D;
