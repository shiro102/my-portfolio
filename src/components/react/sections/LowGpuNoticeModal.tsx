"use client";

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { useTranslation } from "react-i18next";

type LowGpuNoticeModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function LowGpuNoticeModal({
  open,
  onClose,
}: LowGpuNoticeModalProps) {
  const { t } = useTranslation("");

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/50 transition-opacity data-closed:opacity-0"
      />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          transition
          className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl transition-all data-closed:scale-95 data-closed:opacity-0 dark:bg-[#1a1f2e] dark:text-white"
        >
          <DialogTitle className="text-lg font-semibold">
            {t("workroom3D-gpuModalTitle")}
          </DialogTitle>
          <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {t("workroom3D-gpuModalMessage")}
          </p>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              {t("workroom3D-gpuModalOk")}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
