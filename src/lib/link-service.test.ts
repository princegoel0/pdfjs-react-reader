import { describe, expect, it, vi } from 'vitest';
import { createPdfLinkService } from './link-service';

const withOcg = () => {
  const onSetOCGState = vi.fn();
  return { service: createPdfLinkService({ onSetOCGState }), onSetOCGState };
};

describe('executeSetOCGState', () => {
  it('relays the action the engine built, unchanged in substance', () => {
    const { service, onSetOCGState } = withOcg();
    const state = ['ON', '8R', 'OFF', '10R'];
    service.executeSetOCGState({ state, preserveRB: true });
    expect(onSetOCGState).toHaveBeenCalledWith({ state: [...state], preserveRB: true });
  });

  it('treats a missing preserveRB as true, which is what pdf.js defaults to', () => {
    const { service, onSetOCGState } = withOcg();
    service.executeSetOCGState({ state: ['Toggle', '9R'] });
    expect(onSetOCGState).toHaveBeenCalledWith({ state: ['Toggle', '9R'], preserveRB: true });
  });

  it('says nothing when the viewer has no handler for layer actions', () => {
    const service = createPdfLinkService();
    expect(() => service.executeSetOCGState({ state: ['ON', '8R'] })).not.toThrow();
  });

  it('ignores an action whose state list is missing or not a list', () => {
    const { service, onSetOCGState } = withOcg();
    service.executeSetOCGState(null);
    service.executeSetOCGState({});
    service.executeSetOCGState({ state: 'ON' });
    expect(onSetOCGState).not.toHaveBeenCalled();
  });
});
