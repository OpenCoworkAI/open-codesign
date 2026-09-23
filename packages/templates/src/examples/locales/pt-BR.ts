import type { ExampleContent } from '../index';

export const ptBRExamples: Record<string, ExampleContent> = {
  daymark: {
    title: 'Daymark: do briefing às tarefas',
    description:
      'Cinco arquivos editáveis: briefing, tarefas, projetos, logo original e tokens. Conecte Hoje, projetos e edição de tarefas.',
    prompt:
      'Leia product-brief.md, tasks.json, projects.json, logo.svg e DESIGN.md no workspace. Crie Daymark em App.jsx com Hoje, projetos, detalhes e editor de tarefas conectados por estado compartilhado e contadores derivados. Reutilize o logo e os tokens locais. Implemente adicionar, editar, concluir, voltar, validação e estados vazios conforme o briefing. Preserve os arquivos originais e atualize DESIGN.md. Use somente dados simulados: sem backend, autenticação, pagamentos, rede ou instalações. Interface acessível e responsiva em celular e desktop. Visualize e percorra o fluxo antes de concluir; não apresente comportamentos não testados como verificados.',
  },
  'common-ground': {
    title: 'Common Ground: reserva de oficinas',
    description:
      'Briefing, agenda CSV e arte original orientam descoberta, detalhes, reserva e confirmação. Reservas simuladas, não reais.',
    prompt:
      'Leia product-brief.md, schedule.csv, poster.svg, logo.svg e DESIGN.md no workspace. Crie Common Ground em App.jsx com descoberta, detalhes, reserva e confirmação conectados. Reutilize a arte local e use o CSV como fonte de sessões, preços e vagas. Compartilhe seleção e formulário, valide dados e capacidade, impeça duplicação de reservas e restaure vagas ao cancelar. Siga o briefing para navegação e estados vazios. Indique reserva simulada sem cobrança. Preserve os arquivos e atualize DESIGN.md. Sem backend, autenticação, pagamentos, rede ou instalações. Interface acessível e responsiva. Visualize e teste o fluxo; não afirme verificações não realizadas.',
  },
  trailhead: {
    title: 'Trailhead: do esboço ao roteiro',
    description:
      'Esboço SVG original, briefing anotado e viagens fictícias para um editor conectado. As notas não exigem modelo com visão.',
    prompt:
      'Leia sketch-reference.svg, product-brief.md e trips.json no workspace. O SVG é um esboço original de baixa fidelidade, não uma foto nem uma interface pronta. Leia o texto SVG e as anotações mesmo sem suporte a imagens. Transforme os três quadros em viagens, roteiro e editor de paradas conectados em App.jsx. Adicionar, editar, ordenar e excluir devem atualizar um estado único e os totais em todas as telas. Inclua validação, estados vazios e navegação de volta conforme o briefing. Preserve os arquivos e crie DESIGN.md. Somente dados simulados; sem mapas reais, reservas, autenticação, rede ou instalações. Interface responsiva e acessível; visualize e percorra o fluxo antes de concluir, sem afirmar resultados não testados.',
  },
  'cosmic-animation': {
    title: 'Animação em escala cósmica',
    description: 'Hero animado com anéis orbitando, sol brilhante e um campo de estrelas esparso.',
  },
  'organic-loaders': {
    title: 'Loaders orgânicos',
    description: 'Seis indicadores de loading desenhados à mão em pastéis suaves — puro CSS / SVG.',
  },
  'landing-page': {
    title: 'Landing page de marketing',
    description:
      'Landing editorial para uma ferramenta de produtividade: hero, features, prévia de preços.',
  },
  'case-study': {
    title: 'Case de cliente',
    description:
      'Case em uma página, pronto para impressão, com métricas em destaque e citação em destaque do CFO.',
  },
  dashboard: {
    title: 'Dashboard de receita',
    description:
      'Dashboard escuro de analytics: tendência de MRR, pipeline, principais contas, previsão.',
  },
  'pitch-slide': {
    title: 'Slide de pitch — Por que agora',
    description:
      'Um único slide 16:9 com subtítulo, frase de impacto, bullets de apoio e mini gráfico.',
  },
  email: {
    title: 'E-mail de boas-vindas',
    description:
      'E-mail transacional de boas-vindas em tabela, 600px, com três passos de onboarding.',
  },
  'mobile-app': {
    title: 'Tela mobile de rastreador de hábitos',
    description:
      'Tela inicial em moldura de celular com contador de sequência, lista de hábitos e barra de abas inferior.',
  },
  'pricing-page': {
    title: 'Página de preços SaaS',
    description:
      'Três cards de planos com tabela de comparação de features e alternador de faturamento.',
  },
  'blog-article': {
    title: 'Artigo de blog editorial',
    description:
      'Artigo longo com sidebar de índice, citações em destaque e grade de artigos relacionados.',
  },
  'event-calendar': {
    title: 'Calendário de equipe',
    description:
      'Grade de calendário mensal com eventos em múltiplos dias e barra lateral de próximos eventos.',
  },
  'chat-interface': {
    title: 'Tela de mensagens de chat',
    description:
      'UI mobile de mensagens com balões, indicador de digitação e mensagens com imagem.',
  },
  'portfolio-gallery': {
    title: 'Galeria de portfólio fotográfico',
    description:
      'Grid masonry escuro com overlays no hover, filtros de categoria e visual de lightbox.',
  },
  'receipt-invoice': {
    title: 'Fatura para impressão',
    description:
      'Fatura A4 limpa com tabela de itens, detalhamento de impostos e condições de pagamento.',
  },
  'settings-panel': {
    title: 'Página de configurações de app',
    description:
      'Configurações com navegação por sidebar, formulários, toggles e seção de ações críticas.',
  },
  'auth-signin': {
    title: 'Tela de login',
    description:
      'Card centralizado sobre fundo estrelado com e-mail, logins sociais e link de cadastro.',
  },
  'kanban-board': {
    title: 'Quadro Kanban de projeto',
    description:
      'Quadro de três colunas com cards de tarefa, avatares de responsáveis e tags de prioridade.',
  },
  'ai-product-hero': {
    title: 'Hero de produto de IA',
    description: 'Hero com gradiente, orbe brilhante, título com cursor piscando e dois CTAs.',
  },
  'weather-card': {
    title: 'Card de clima mobile',
    description: 'Tela de clima glassmorphism com faixa horária e resumo de sete dias.',
  },
  'timeline-changelog': {
    title: 'Linha do tempo de changelog',
    description:
      'Linha do tempo vertical de releases com pontos coloridos e categorias filtráveis.',
  },
  'stats-counter': {
    title: 'Faixa animada de estatísticas',
    description: 'Trio de cards com contadores animados, detalhes em neon e fundos brilhantes.',
  },
};
