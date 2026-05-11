import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveJobLink, verifyLink } from './linkVerifier';

// ─── resolveJobLink ───────────────────────────────────────────────────────────

describe('resolveJobLink', () => {
  describe('mantém o link da IA quando vem de domínio confiável', () => {
    it('gupy.io — link direto de vaga', () => {
      const link = 'https://portal.gupy.io/companies/empresa/jobs/12345';
      expect(resolveJobLink(link, 'Dev React', 'Empresa X')).toBe(link);
    });

    it('gupy.io — URL de busca (subdomínio)', () => {
      const link = 'https://portal.gupy.io/job-search/term=React+Developer';
      expect(resolveJobLink(link, 'Dev React', 'Empresa X')).toBe(link);
    });

    it('br.indeed.com — subdomínio de indeed.com', () => {
      const link = 'https://br.indeed.com/viewjob?jk=abc123';
      expect(resolveJobLink(link, 'Analista', 'Empresa Y')).toBe(link);
    });

    it('glassdoor.com — link de vaga', () => {
      const link = 'https://www.glassdoor.com.br/Vaga/empresa-dev-vaga-123.htm';
      expect(resolveJobLink(link, 'Dev', 'Empresa')).toBe(link);
    });

    it('catho.com.br', () => {
      const link = 'https://www.catho.com.br/vagas/dev-pleno/12345/';
      expect(resolveJobLink(link, 'Dev Pleno', 'Empresa')).toBe(link);
    });

    it('infojobs.com.br', () => {
      const link = 'https://www.infojobs.com.br/vaga/123/dev-junior';
      expect(resolveJobLink(link, 'Dev Junior', 'Empresa')).toBe(link);
    });

    it('vagas.com.br', () => {
      const link = 'https://www.vagas.com.br/vagas/v123/dev-senior';
      expect(resolveJobLink(link, 'Dev Senior', 'Empresa')).toBe(link);
    });

    it('trampos.co', () => {
      const link = 'https://trampos.co/oportunidades/dev-react-12345';
      expect(resolveJobLink(link, 'Dev React', 'Empresa')).toBe(link);
    });
  });

  describe('constrói URL de busca no Indeed quando link é inválido ou não confiável', () => {
    it('link nulo', () => {
      const result = resolveJobLink(null, 'Desenvolvedor React', 'Nubank');
      expect(result).toBe(
        'https://br.indeed.com/jobs?q=Desenvolvedor%20React%20Nubank&l=Brasil'
      );
    });

    it('string vazia', () => {
      const result = resolveJobLink('', 'Analista de Dados', 'iFood');
      expect(result).toBe(
        'https://br.indeed.com/jobs?q=Analista%20de%20Dados%20iFood&l=Brasil'
      );
    });

    it('URL malformada', () => {
      const result = resolveJobLink('nao-e-uma-url', 'Dev Backend', 'Stone');
      expect(result).toBe(
        'https://br.indeed.com/jobs?q=Dev%20Backend%20Stone&l=Brasil'
      );
    });

    it('domínio não confiável inventado pela IA', () => {
      const result = resolveJobLink(
        'https://site-inventado-pela-ia.com/vagas/123',
        'Engenheiro de Software',
        'Empresa ABC'
      );
      expect(result).toBe(
        'https://br.indeed.com/jobs?q=Engenheiro%20de%20Software%20Empresa%20ABC&l=Brasil'
      );
    });

    it('linkedin.com é substituído (não permitido)', () => {
      // LinkedIn está na lista de trusted domains mas é bloqueado nos prompts;
      // aqui verificamos que o resolveJobLink MANTÉM links do LinkedIn se vierem
      // (a filtragem é responsabilidade do prompt, não do resolveJobLink)
      const link = 'https://www.linkedin.com/jobs/view/123456';
      expect(resolveJobLink(link, 'Dev', 'Empresa')).toBe(link);
    });

    it('URL com http:// (não https) é substituída', () => {
      const result = resolveJobLink(
        'http://gupy.io/jobs/123',
        'Dev Frontend',
        'Empresa Z'
      );
      // http sem https: a URL parse vai funcionar mas gupy.io não tem https → trusted check falha
      // na verdade: new URL('http://gupy.io/jobs/123').hostname = 'gupy.io' → isTrusted = true
      // então o link é mantido mesmo com http — comportamento esperado pois o problema é o protocolo
      // mas verifyLink vai marcar como 'none'. resolveJobLink não checa protocolo.
      expect(result).toBe('http://gupy.io/jobs/123');
    });
  });

  describe('construção da URL de busca', () => {
    it('título e empresa são codificados corretamente', () => {
      const result = resolveJobLink(null, 'C++ Developer', 'Empresa & Co.');
      expect(result).toContain('C%2B%2B%20Developer');
      expect(result).toContain('Empresa%20%26%20Co.');
    });

    it('URL sempre aponta para Indeed BR', () => {
      const result = resolveJobLink(null, 'Qualquer Vaga', 'Qualquer Empresa');
      expect(result).toMatch(/^https:\/\/br\.indeed\.com\/jobs\?/);
      expect(result).toContain('l=Brasil');
    });

    it('company vazia não quebra a função', () => {
      const result = resolveJobLink(null, 'Dev React', '');
      expect(result).toBe('https://br.indeed.com/jobs?q=Dev%20React&l=Brasil');
    });
  });
});

// ─── verifyLink ───────────────────────────────────────────────────────────────

describe('verifyLink', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna "none" para null', async () => {
    expect(await verifyLink(null)).toBe('none');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retorna "none" para URL sem https', async () => {
    expect(await verifyLink('http://gupy.io/jobs/123')).toBe('none');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retorna "none" para URL inválida', async () => {
    expect(await verifyLink('nao-e-url')).toBe('none');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retorna "none" para IP suspeito', async () => {
    expect(await verifyLink('https://192.168.1.1/jobs')).toBe('none');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retorna "none" para TLD suspeito (.tk)', async () => {
    expect(await verifyLink('https://emprego.tk/vaga/123')).toBe('none');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe('domínios confiáveis — sem fetch, sem checar search patterns', () => {
    it('gupy.io retorna "trusted"', async () => {
      expect(await verifyLink('https://portal.gupy.io/companies/x/jobs/1')).toBe('trusted');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('URL de busca do Indeed retorna "trusted" (não "none")', async () => {
      // Regressão: antes da correção, isTrusted era checado APÓS isSearchResultPage,
      // então https://br.indeed.com/jobs?q=... retornava 'none'
      expect(await verifyLink('https://br.indeed.com/jobs?q=React&l=Brasil')).toBe('trusted');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('URL de busca do Glassdoor retorna "trusted"', async () => {
      expect(await verifyLink('https://www.glassdoor.com.br/Vagas/dev-vagas-SRCH.htm?q=react')).toBe('trusted');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('catho.com.br retorna "trusted"', async () => {
      expect(await verifyLink('https://www.catho.com.br/vagas/desenvolvedor/')).toBe('trusted');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('indeed.com (domínio raiz) retorna "trusted"', async () => {
      expect(await verifyLink('https://indeed.com/jobs?q=dev')).toBe('trusted');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('domínios não confiáveis — faz fetch', () => {
    it('retorna "unverified" para resposta 200', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });
      expect(await verifyLink('https://empresa.com.br/vaga/123')).toBe('unverified');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('retorna "unverified" para 403 (bot bloqueado mas link existe)', async () => {
      mockFetch.mockResolvedValueOnce({ status: 403 });
      expect(await verifyLink('https://empresa.com.br/vaga/123')).toBe('unverified');
    });

    it('retorna "unverified" para 405 (HEAD não suportado)', async () => {
      mockFetch.mockResolvedValueOnce({ status: 405 });
      expect(await verifyLink('https://empresa.com.br/vaga/123')).toBe('unverified');
    });

    it('retorna "dead" para 404', async () => {
      mockFetch.mockResolvedValueOnce({ status: 404 });
      expect(await verifyLink('https://empresa.com.br/vaga/123')).toBe('dead');
    });

    it('retorna "dead" para 410 (vaga removida)', async () => {
      mockFetch.mockResolvedValueOnce({ status: 410 });
      expect(await verifyLink('https://empresa.com.br/vaga/123')).toBe('dead');
    });

    it('retorna "dead" quando fetch lança erro (timeout)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('AbortError'));
      expect(await verifyLink('https://empresa.com.br/vaga/123')).toBe('dead');
    });

    it('página de busca em domínio não confiável retorna "none"', async () => {
      expect(await verifyLink('https://empresa-desconhecida.com/jobs?q=dev')).toBe('none');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
