# Foco dos campos do programa no iOS

A edição inline usa o foco e a seleção nativos do navegador. O aplicativo não refaz o foco, não redefine a seleção ao tocar e não agenda correções de rolagem durante a abertura do teclado. O DOM em edição também é preservado durante composição, salvamento e sincronização.

## Falhas reproduzidas na página completa

Em 8 de novembro de 2026, os seguintes comportamentos foram reproduzidos em Chromium e WebKit, com todos os scripts locais do index carregados e dados sintéticos:

- Ao focar o último campo em Perguntas, a reserva inferior caía de 69px para zero. A altura do documento diminuía de 1318px para 1249px e `scrollY` era limitado de 445px para 376px. O campo descia 69px mesmo usando `focus({preventScroll:true})` no teste.
- Ao focar durante a expansão, o wrapper com `overflow:hidden` rolava internamente 11–12px. Quando a animação terminava, essa rolagem desaparecia e o campo mudava novamente de posição.
- Com largura de 320px e fonte no nível 11, o placeholder em fluxo ocupava duas linhas. A primeira letra reduzia a altura do campo de 110px para 66,5px. Um `<br>` vazio podia somar mais uma linha.

## Correção

O index mantém o espaço do navbar reservado mesmo quando a barra visual se oculta. O wrapper da animação usa `overflow:clip`, mantendo `min-height:0`, e a expansão termina imediatamente quando o campo recebe foco. O placeholder fica fora do fluxo e usa reticências quando não cabe na linha. Campos recolhidos ficam `inert`, fora da navegação de foco, e voltam a ser interativos ao abrir.

Essas regras corrigem mudanças de geometria sem criar outro controlador do cursor. `tests/test_program_focus_layout.py` cobre a página completa; `tests/test_program_caret.py` verifica seleção, composição e ausência de reposicionamento adicional. `tests/test_program_summary.py` cobre a ida e volta ao editor completo.

## Base técnica e limite da validação

O [WebKit distingue o viewport visual do layout](https://webkit.org/blog/9674/new-webkit-features-in-safari-13/#visual-viewport-api). A integração nativa em [`WKContentViewInteraction.mm`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm), especialmente `rectToRevealWhenZoomingToFocusedElement`, `_zoomToRevealFocusedElement` e `RevealFocusedElementDeferralReason`, espera dados de seleção após layout e notificações do teclado para revelar o campo. Alterar as dimensões nessa sequência invalida a posição que está sendo revelada.

A [especificação de overflow](https://drafts.csswg.org/css-overflow-3/#valdef-overflow-hidden) define que `hidden` continua sendo um contêiner de rolagem; `clip` não é. O [algoritmo de revelação](https://drafts.csswg.org/cssom-view/#scroll-a-target-into-view) percorre esses contêineres do mais interno ao mais externo.

Os testes automatizados reproduzem as falhas de layout, mas o WebKit de desktop não executa o teclado UIKit do iPhone. Eventos simulados de `visualViewport` verificam interferências do aplicativo; sozinhos, não comprovam que o teclado nativo revelou o cursor.
