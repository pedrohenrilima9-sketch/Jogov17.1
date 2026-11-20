# Leilão de Futebol - Versão 17

A versão 17 preserva toda a estrutura, leilão, formações, comunicação P2P (PeerJS), escalação e simulação da V16, e adiciona:

- Sistema de contas aprimorado com login automático (localStorage), sair e trocar de conta. Senhas com hash SHA-256 (nunca em texto puro).
- Aba de Amigos com códigos de amizade únicos, adicionar por nome ou código, botão de convidar (copia link da sala).
- Aba de Clubes: criar público/privado com código exclusivo, entrar por código, lista de membros, vitórias/derrotas, ranking básico e histórico.
- Cards de jogadores estilo FIFA/EA FC na escalação (foto, overall, nome, posição, badge de posição).
- Fotos dos jogadores via Wikipedia (miniatura) no leilão e nos cards; fallback para inicial se não disponível.
- Base para decisões interativas durante a simulação (modal de escolha de ação no ataque/defesa; resultado depende de overall, atributos derivados e fator de sorte).
- Melhorias de estabilidade e reconexão (preserva vaga, código da última sala, botão de reconectar).
- Atualização automática de estatísticas locais após registro de resultados.

## Como usar

1. Abra `index.html` ou `Sala.html` em um navegador moderno (Chrome/Firefox recomendado).
2. Na tela de salas, crie uma conta ou faça login (será lembrado automaticamente).
3. Compartilhe seu **código de amizade** para outros adicionarem você (dados locais).
4. Crie ou entre em salas pelo código de 6 dígitos. Use o botão "Convidar" ao lado dos amigos.
5. Monte o time, leiloe jogadores, escale com as formações existentes.
6. Inicie o torneio. Durante a transmissão ao vivo, decisões interativas podem aparecer para jogadores humanos.
7. Clubes: crie, compartilhe o código, registre vitórias/derrotas. Ranking individual é local.

## Limitações importantes (sem backend próprio)

- **Contas, amigos e clubes são locais** ao navegador/dispositivo. Não sincronizam automaticamente entre celulares, computadores ou navegadores diferentes.
- Para adicionar amigos de outros dispositivos: compartilhe o código de amizade. A lista fica salva apenas localmente em cada um.
- Status "online" real e solicitações de amizade entre dispositivos diferentes exigem um servidor de presença/sinalização central.
- Clubes e rankings compartilhados entre múltiplos dispositivos também precisam de backend (ex.: API + banco de dados).
- A comunicação de sala continua P2P via PeerJS (usa servidores STUN públicos do Google + sinalização PeerJS gratuita). O anfitrião precisa manter a aba aberta.
- Fotos dependem da Wikipedia e de conexão à internet. Nem todos os jogadores têm miniatura disponível.
- Decisões interativas estão implementadas como base; a simulação automática continua para bots e como fallback.
- Desconexões temporárias são toleradas (reconexão pelo código), mas o navegador pode suspender timers em segundo plano.

## Instalação e execução

- Não precisa de servidor. Basta abrir os arquivos HTML localmente ou hospedar em qualquer servidor estático (GitHub Pages, Netlify, etc.).
- Arquivos principais: `index.html`, `Sala.html`, `sala.js`, `social.js`, `script_jogadores.js`, `leilao.css`, `sala.css`.
- PeerJS é carregado via CDN (unpkg).

Preservamos 100% das funcionalidades da V16. As melhorias são aditivas.

Versão gerada em 2026.
