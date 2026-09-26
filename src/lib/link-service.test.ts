import { describe, expect, it, vi } from 'vitest';
import { createPdfLinkService } from './link-service';

const withOcg = () => {
  const onSetOCGState = vi.fn();
  return { service: createPdfLinkService({ onSetOCGState }), onSetOCGState };
};

describe('getAttachmentContent', () => {
  it('hands pdf.js the bytes the engine has for an id', async () => {
    const service = createPdfLinkService({
      getAttachmentContent: async (id) => new TextEncoder().encode(`bytes for ${id}`),
    });
    const content = await service.getAttachmentContent('attachmentRef:23 0 R');
    const text = content === null ? content : new TextDecoder().decode(content);
    expect(text).toBe('bytes for attachmentRef:23 0 R');
  });

  it('answers null when the viewer has no way to read files', async () => {
    const service = createPdfLinkService();
    await expect(service.getAttachmentContent('anything')).resolves.toBeNull();
  });

  it('does not let a failed read escape into pdf.js’s click handler', async () => {
    const service = createPdfLinkService({
      getAttachmentContent: async () => {
        throw new Error('encrypted');
      },
    });
    await expect(service.getAttachmentContent('anything')).resolves.toBeNull();
  });
});

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
