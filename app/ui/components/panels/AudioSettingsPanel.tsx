import { ChangeEvent } from "react";
import { usePatch } from "../../state/PatchContext";

interface AudioSettingsPanelProps {
  onClose(): void;
}

const SAMPLE_RATE_OPTIONS = [44_100, 48_000, 96_000] as const;
const BLOCK_SIZE_OPTIONS = [128, 256, 512] as const;
const OVERSAMPLING_OPTIONS = [1, 2, 4, 8] as const;

export function AudioSettingsPanel({ onClose }: AudioSettingsPanelProps): JSX.Element {
  const { viewModel, updatePatchSettings } = usePatch();

  const handleSampleRateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const sampleRate = Number.parseInt(event.target.value, 10);
    updatePatchSettings({ sampleRate });
  };

  const handleBlockSizeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const blockSize = Number.parseInt(event.target.value, 10) as (typeof BLOCK_SIZE_OPTIONS)[number];
    updatePatchSettings({ blockSize });
  };

  const handleOversamplingChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const oversampling = Number.parseInt(event.target.value, 10) as (typeof OVERSAMPLING_OPTIONS)[number];
    updatePatchSettings({ oversampling });
  };

  return (
    <aside className="dock-panel" aria-label="Audio properties">
      <header className="dock-panel__header">
        <h2 className="dock-panel__title">Audio Properties</h2>
        <button type="button" className="dock-panel__close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dock-panel__body">
        <section className="properties-section">
          <h4>Patch Settings</h4>
          <div className="audio-settings">
            <label>
              <span>Sample rate</span>
              <select value={viewModel.sampleRate} onChange={handleSampleRateChange}>
                {SAMPLE_RATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.toLocaleString()} Hz
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Block size</span>
              <select value={viewModel.blockSize} onChange={handleBlockSizeChange}>
                {BLOCK_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option} frames
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Oversampling</span>
              <select value={viewModel.oversampling} onChange={handleOversamplingChange}>
                {OVERSAMPLING_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}×
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>
    </aside>
  );
}
