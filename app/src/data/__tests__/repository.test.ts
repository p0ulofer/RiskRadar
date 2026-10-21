import * as FileSystem from 'expo-file-system/legacy';

import {
  clearCache,
  hotspotById,
  isHotspotsDocument,
  loadHotspots,
  parseHotspotsDocument,
  refreshFromRemote,
  seedDocument,
} from '@/data/repository';
import type { HotspotInfra, HotspotsDocument } from '@/types/hotspots';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

const fs = FileSystem as jest.Mocked<typeof FileSystem>;

function cloneSeed(): HotspotsDocument {
  return JSON.parse(JSON.stringify(seedDocument)) as HotspotsDocument;
}

function jsonResponse(value: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => value,
  } as Response;
}

describe('repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.getInfoAsync.mockResolvedValue({ exists: false } as never);
    fs.readAsStringAsync.mockResolvedValue('');
    fs.writeAsStringAsync.mockResolvedValue(undefined as never);
    fs.deleteAsync.mockResolvedValue(undefined as never);
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('usa o seed quando não existe cache', async () => {
    const result = await loadHotspots();
    expect(result.source).toBe('seed');
    expect(result.document.meta.fonte).toBe('prf');
    expect(result.document.hotspots.length).toBeGreaterThan(0);
  });

  it('usa o cache quando ele é válido', async () => {
    const cached = cloneSeed();
    cached.meta.data_version = seedDocument.meta.data_version;
    fs.getInfoAsync.mockResolvedValue({ exists: true } as never);
    fs.readAsStringAsync.mockResolvedValue(JSON.stringify(cached));

    const result = await loadHotspots();
    expect(result.source).toBe('cache');
    expect(result.document.meta.data_version).toBe(seedDocument.meta.data_version);
  });

  it('descarta o cache de outra versão e usa o seed atual', async () => {
    const cached = cloneSeed();
    cached.meta.data_version = '20260101-deadbeef';
    fs.getInfoAsync.mockResolvedValue({ exists: true } as never);
    fs.readAsStringAsync.mockResolvedValue(JSON.stringify(cached));

    const result = await loadHotspots();
    expect(result.source).toBe('seed');
    expect(result.document.meta.data_version).toBe(seedDocument.meta.data_version);
    expect(fs.deleteAsync).toHaveBeenCalled();
  });

  it('cai no seed e limpa o cache quando o JSON está corrompido', async () => {
    fs.getInfoAsync.mockResolvedValue({ exists: true } as never);
    fs.readAsStringAsync.mockResolvedValue('{corrompido');

    const result = await loadHotspots();
    expect(result.source).toBe('seed');
    expect(result.error).toContain('Cache inválido');
    expect(fs.deleteAsync).toHaveBeenCalled();
  });

  it('limpa o cache', async () => {
    await clearCache();
    expect(fs.deleteAsync).toHaveBeenCalledWith(
      'file:///documents/riskradar-hotspots.json',
      { idempotent: true }
    );
  });

  it('valida o formato do documento', () => {
    expect(isHotspotsDocument(seedDocument)).toBe(true);
    expect(isHotspotsDocument({ meta: {}, hotspots: [] })).toBe(false);
    expect(parseHotspotsDocument(JSON.stringify(seedDocument)).meta.total_hotspots).toBeGreaterThan(0);
    expect(() => parseHotspotsDocument('{}')).toThrow('Formato de dados inválido');
    expect(() => parseHotspotsDocument('não é json')).toThrow('JSON inválido');
  });

  it('aceita infra opcional e rejeita infra malformada', () => {
    const withInfra = cloneSeed();
    withInfra.hotspots[0].infra = {
      traffic_signals: 1,
      crossing: 2,
      traffic_calming: 0,
      speed_camera: 0,
    };
    expect(isHotspotsDocument(withInfra)).toBe(true);

    const withoutInfra = cloneSeed();
    delete withoutInfra.hotspots[0].infra;
    expect(isHotspotsDocument(withoutInfra)).toBe(true);

    const malformed = cloneSeed();
    malformed.hotspots[0].infra = { traffic_signals: '1' } as unknown as HotspotInfra;
    expect(isHotspotsDocument(malformed)).toBe(false);
  });

  it('encontra hotspot por id', () => {
    const first = seedDocument.hotspots[0];
    expect(hotspotById(seedDocument, first.id)?.id).toBe(first.id);
    expect(hotspotById(seedDocument, 'inexistente')).toBeUndefined();
  });

  it('não baixa hotspots quando a versão remota é igual', async () => {
    const meta = cloneSeed().meta;
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(meta));

    const result = await refreshFromRemote('https://dados.test/', meta.data_version);
    expect(result.updated).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://dados.test/meta.json',
      expect.anything()
    );
  });

  it('baixa e grava o cache quando a versão muda', async () => {
    const remote = cloneSeed();
    remote.meta.data_version = '20260202-cafebabe';
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(remote.meta))
      .mockResolvedValueOnce(jsonResponse(remote));

    const result = await refreshFromRemote('https://dados.test', '20260101-deadbeef');
    expect(result.updated).toBe(true);
    expect(result.meta?.data_version).toBe('20260202-cafebabe');
    expect(fs.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///documents/riskradar-hotspots.json',
      expect.stringContaining('20260202-cafebabe')
    );
  });

  it('não substitui o cache quando o JSON remoto é inválido', async () => {
    const remote = cloneSeed();
    remote.meta.data_version = '20260202-cafebabe';
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(remote.meta))
      .mockResolvedValueOnce(jsonResponse({ meta: {}, hotspots: [] }));

    const result = await refreshFromRemote('https://dados.test', '20260101-deadbeef');
    expect(result.updated).toBe(false);
    expect(result.error).toContain('inválido');
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('trata falhas de rede sem lançar', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('sem internet'));
    const result = await refreshFromRemote('https://dados.test', '20260101-deadbeef');
    expect(result.updated).toBe(false);
    expect(result.error).toContain('sem internet');
  });
});
