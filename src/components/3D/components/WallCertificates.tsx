"use client";

import { useTexture } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import * as THREE from "three";

const CERT_TEXTURES = {
  practitioner: "/certificates/aws-cloud-practitioner.jpg",
  architect: "/certificates/aws-solutions-architect.jpg",
} as const;

const VERIFY_URLS = {
  practitioner:
    "https://cp.certmetrics.com/amazon/en/public/verify/credential/985b89975d2a4a3b9a108019a9b6e5e5",
  architect:
    "https://cp.certmetrics.com/amazon/en/public/verify/credential/4E548B22TM4QQGC0",
} as const;

/** Display face size in mesh local units (WallPictureBrown / Cube037_1). */
const PLANE_WIDTH = 0.885;
const PLANE_HEIGHT = 0.87;
const PLANE_GAP = 0.02;

type WallCertificatesProps = {
  visible?: boolean;
  onHoverPractitioner: (hovered: boolean) => void;
  onHoverArchitect: (hovered: boolean) => void;
};

function configurePhotoTexture(texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
}

useTexture.preload([CERT_TEXTURES.practitioner, CERT_TEXTURES.architect]);

export default function WallCertificates({
  visible = true,
  onHoverPractitioner,
  onHoverArchitect,
}: WallCertificatesProps) {
  const [texPractitioner, texArchitect] = useTexture([
    CERT_TEXTURES.practitioner,
    CERT_TEXTURES.architect,
  ]);
  const { invalidate } = useThree();

  useLayoutEffect(() => {
    configurePhotoTexture(texPractitioner);
    configurePhotoTexture(texArchitect);
    invalidate();
  }, [texPractitioner, texArchitect, invalidate]);

  if (!visible) return null;

  const stackOffset = (PLANE_HEIGHT + PLANE_GAP) / 2;

  const setCursor = (pointer: boolean) => {
    document.body.style.cursor = pointer ? "pointer" : "";
  };

  return (
    <group position={[0, -0.44, 0.003]} rotation={[Math.PI / 2, Math.PI / 2, 0]}>
      <mesh
        position={[0, stackOffset, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHoverPractitioner(true);
          setCursor(true);
          invalidate();
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          onHoverPractitioner(false);
          setCursor(false);
          invalidate();
        }}
        onClick={(e) => {
          e.stopPropagation();
          window.open(VERIFY_URLS.practitioner, "_blank");
        }}
      >
        <planeGeometry args={[PLANE_WIDTH, PLANE_HEIGHT]} />
        <meshBasicMaterial map={texPractitioner} toneMapped={false} />
      </mesh>

      <mesh
        position={[0, -stackOffset, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHoverArchitect(true);
          setCursor(true);
          invalidate();
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          onHoverArchitect(false);
          setCursor(false);
          invalidate();
        }}
        onClick={(e) => {
          e.stopPropagation();
          window.open(VERIFY_URLS.architect, "_blank");
        }}
      >
        <planeGeometry args={[PLANE_WIDTH, PLANE_HEIGHT]} />
        <meshBasicMaterial map={texArchitect} toneMapped={false} />
      </mesh>
    </group>
  );
}
