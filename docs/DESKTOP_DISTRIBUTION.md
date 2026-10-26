# Distribuição do Morubi Desktop

## Estado de produção

O onboarding, o diagnóstico efêmero, a observação em segundo plano e o lifecycle de tray/menu bar estão implementados. Isso não torna o instalador globalmente pronto: Windows e macOS ainda exigem assinatura e validação física. O áudio remoto é nativo no macOS 13+, mas o macOS 12 ainda tem uma dependência de distribuição não resolvida.

## Windows

- Gerar instalador NSIS x64 assinado com certificado de code signing da Morubi.
- Validar Windows 10 e 11 com Chrome/Edge, microfone USB/Bluetooth e saída padrão.
- Medir consumo, suspensão/retomada, troca de dispositivo e continuidade com a janela oculta.
- O seletor de fonte é uma autorização explícita do sistema; frames de vídeo não são lidos nem armazenados.

## macOS

- Assinar com Developer ID, incluir entitlement/descrição de microfone, notarizar e validar prompts TCC no bundle distribuído.
- Produzir e testar builds Intel x64 e Apple Silicon; um build Intel local não comprova compatibilidade universal.
- O Electron usado pelo projeto não fornece no macOS o mesmo loopback disponível no Windows. Por isso o bundle inclui um helper Swift próprio: ScreenCaptureKit no macOS 13+, somente áudio. O macOS 14.2 oferece Process Tap, ainda não integrado. Monterey permanece sem uma API nativa equivalente no SDK alvo.
- `pnpm --filter @morubi/desktop build:mac:dist` prepara artefatos x64 e arm64; assinatura, notarização e validação física continuam gates externos.

Para gerar o bundle Intel local de desenvolvimento/teste, configure
`MORUBI_MAC_SIGNING_IDENTITY` com uma identidade de code signing presente no
Keychain e execute `pnpm --filter @morubi/desktop build:mac:test`. O resultado
fica em `apps/desktop/release/mac/Morubi.app`. A mesma identidade deve ser usada
entre reconstruções: o TCC associa permissões à designated requirement da
assinatura, não apenas ao bundle identifier.

`build:mac:test:adhoc` existe somente para recuperação local explícita. Cada
alteração do conteúdo gera outro CDHash e pode invalidar permissões de Gravação
da Tela e acesso ao Keychain. A assinatura ad hoc nunca é artefato comercial.
Distribuição exige certificado Developer ID Application da Morubi, hardened
runtime, notarização e validação do instalador final.

### Bloqueador do componente de áudio no macOS 12

O fallback reconhece BlackHole 2ch, mas o Morubi **não o embute, baixa ou instala**. O [projeto oficial](https://github.com/ExistentialAudio/BlackHole) o publica sob GPL-3.0 e informa que projetos não GPLv3 precisam tratar uma licença separada com a Existential Audio. Antes de qualquer instalação assistida para Monterey, são obrigatórios:

1. aprovação jurídica e licença compatível com a distribuição comercial do Morubi;
2. pacote versionado, assinado e verificável, sem download silencioso;
3. tela de consentimento que explique o componente e as alterações de áudio;
4. instalação com privilégio explícito do sistema;
5. health check pós-instalação e rollback/desinstalação testados;
6. restauração comprovada da saída padrão e ausência de impacto em outros aplicativos;
7. validação em Monterey, Ventura, Sonoma e nas arquiteturas suportadas.

Até esses itens serem concluídos, o macOS 12 não pode ser declarado zero-config para `SYSTEM_AUDIO`. No macOS 13+, o caminho normal não depende de driver nem de configuração em Áudio MIDI.

## Rollback e desinstalação

O Morubi atual não possui instalador assistido do componente, portanto não há rollback de driver a executar nem a simular. Quando a distribuição for aprovada, instalação e rollback deverão ser uma unidade testável e reversível. A desinstalação do Morubi não poderá deixar device agregado, saída padrão alterada, serviço privilegiado ou credencial residual.

## Critério de liberação

Uma plataforma só pode ser marcada como pronta após teste em instalador assinado, conta real, reunião real, permissões limpas, duas fontes com sinal, janela oculta, encerramento explícito, logout, falha de dispositivo, suspensão/retomada e desinstalação. Testes unitários e mocks não substituem essa validação.
