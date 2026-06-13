import { DirectionalLightHelper, CameraHelper } from "three";
import { useRef, useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useDarkMode } from "@/components/react/context/DarkModeContext";

const LightHelper = ({
  showHelpers = false,
  castShadows = true,
}: {
  showHelpers?: boolean;
  castShadows?: boolean;
}) => {
  const lightRef = useRef<THREE.DirectionalLight>(null!);
  const anotherLightRef = useRef<THREE.DirectionalLight>(null!);
  const bounceLightRef = useRef<THREE.DirectionalLight>(null!);
  const { scene } = useThree();
  const scaleLevel = 1 / 0.085;
  const { isDark } = useDarkMode();

  useEffect(() => {
    if (!showHelpers) return;

    let dirHelper: DirectionalLightHelper, shadowCamHelper: CameraHelper;
    let anotherDirHelper: DirectionalLightHelper,
      anotherShadowCamHelper: CameraHelper;
    let bounceHelper: DirectionalLightHelper;

    if (lightRef.current) {
      const light = lightRef.current;
      dirHelper = new DirectionalLightHelper(light, 1);
      shadowCamHelper = new CameraHelper(light.shadow.camera);
      scene.add(dirHelper);
      scene.add(shadowCamHelper);
    }

    const anotherLight = anotherLightRef.current;
    if (anotherLight && lightRef.current) {
      anotherDirHelper = new DirectionalLightHelper(anotherLight, 1);
      anotherShadowCamHelper = new CameraHelper(lightRef.current.shadow.camera);
      scene.add(anotherDirHelper);
      scene.add(anotherShadowCamHelper);
    }

    if (bounceLightRef.current) {
      bounceHelper = new DirectionalLightHelper(bounceLightRef.current, 0.5);
      scene.add(bounceHelper);
    }

    return () => {
      if (dirHelper) scene.remove(dirHelper);
      if (shadowCamHelper) scene.remove(shadowCamHelper);
      if (anotherDirHelper) scene.remove(anotherDirHelper);
      if (anotherShadowCamHelper) scene.remove(anotherShadowCamHelper);
      if (bounceHelper) scene.remove(bounceHelper);
    };
  }, [showHelpers]);

  return (
    <>
      {!isDark && (
        <directionalLight
          ref={lightRef}
          castShadow={castShadows}
          position={[-3 * scaleLevel, 1.5 * scaleLevel, -0.8 * scaleLevel]}
          intensity={6}
          color={0xffffcc}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={0.5 * scaleLevel}
          shadow-camera-far={20 * scaleLevel}
          shadow-camera-left={-3 * scaleLevel}
          shadow-camera-right={4 * scaleLevel}
          shadow-camera-top={0.1 * scaleLevel}
          shadow-camera-bottom={-3 * scaleLevel}
          shadow-bias={-0.0001}
        />
      )}

      <directionalLight
        ref={bounceLightRef}
        position={[0 * scaleLevel, 3 * scaleLevel, 1 * scaleLevel]}
        intensity={2.5}
        color={0xffffff}
      />

      <directionalLight
        ref={anotherLightRef}
        castShadow={castShadows}
        position={[0, 10, 5]} // light above and in front
        intensity={isDark ? 2.0 : 0.6}
        color={isDark ? 0xffffff : 0xffffcc}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.001}
      />
    </>
  );
};

export default LightHelper;
