# Destaques das perguntas

A extração colorida é independente da resposta escrita. A marcação usa somente a pergunta sem seu número e os parágrafos associados. O pedido retorna cláusulas da pergunta e citações literais suficientes para responder por completo. Um exemplo curto e genérico de acontecimentos demonstra como preservar decisão, ação, causa/alvo e desfecho; um segundo exemplo distingue o conteúdo do estudo de uma frase posterior de roteiro. Não há rótulo de raciocínio na saída: o nome de cada acontecimento precisa estar no próprio trecho selecionado. Não são pedidos resumos, explicações, imagens, busca externa, âncoras duplicadas ou conteúdo de anotações pessoais no caminho de destaque.

A resposta conversacional e a aba de leitura literal mantêm suas instruções em outro pedido, executado em paralelo. Seus textos não delimitam as marcas. Falhas da resposta escrita não impedem os destaques, e uma falha na extração não apaga marcas anteriores. Pedidos simultâneos da mesma pergunta compartilham uma execução de cada tipo. A conclusão assíncrona preserva a aba selecionada. O retorno JSON pode vir como envelope `sub_questions`, lista de partes ou parte única; os campos são validados antes de aceitar qualquer formato. Uma resposta escrita HTTP 200 truncada ou inválida tenta o modelo seguinte. Na extração, falhas temporárias e JSON inválido têm uma nova tentativa no mesmo modelo avaliado, sem trocar silenciosamente de seletor; erros permanentes e limite de requisições não são repetidos. Se todas as tentativas falharem, a resposta escrita anterior é preservada e o erro não é salvo como resposta.

## Cores e precisão

- Amarelo, verde e azul representam a primeira, segunda e terceira solicitações reais, na ordem da pergunta original. A ordem do JSON não determina a cor.
- Um grupo como 1–2 não representa duas perguntas. Vírgulas, listas de acontecimentos e perguntas mencionadas no corpo da resposta não criam novas cores.
- As cláusulas retornadas precisam corresponder ao enunciado. Sem uma divisão verificável, os trechos permanecem amarelos.
- Cada citação deve ocorrer de forma inequívoca no parágrafo indicado e começar/terminar em limites de palavras. Não existe expansão por semelhança, distância de edição ou uma única âncora.
- As seleções são validadas antes de substituir marcas anteriores. Trechos inválidos, ambíguos, fora de contexto ou inteiramente protegidos preservam o estado anterior.
- Marcas manuais nunca são sobrescritas. Recolorir uma marca de IA manualmente transfere seu controle ao usuário.
- Referências de apoio entre parênteses, referências finais após travessão e notas ficam sem cor. Um link que integra a resposta — como o Salmo 91 que será estudado — pode ser marcado sem perder a interação.
- A aplicação preserva o texto e os elementos do artigo, não aninha marcas e salva cada parágrafo alterado uma vez.
- A revelação da cor percorre os trechos da esquerda para a direita, na ordem do texto. O cache recebe a marca final antes da animação, sem estado transitório. Regenerar, recolorir manualmente ou ativar redução de movimento cancela a animação com segurança.

## Modelos

Verificação em 8 de novembro de 2026:

- Principal da extração: `gemini-3.5-flash-lite`, estável, com `thinkingLevel: minimal` e teto de 1.536 tokens de saída.
- A extração faz no máximo duas tentativas no mesmo modelo. Os modelos alternativos avaliados omitiram fatos ou acrescentaram texto dispensável nesses casos, por isso não são usados automaticamente para marcar.
- A resposta escrita usa `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite`, com pensamento mínimo e teto de 2.500 tokens, em um pedido independente. As análises complementares deste agente também usam essa lista; a configuração do Tutor flutuante não é alterada aqui.
- O antigo `gemini-3.1-flash-lite-preview` está listado como desligado em 25 de maio de 2026. Ele não integra mais a seleção de modelos deste agente. O erro de formato foi reproduzido mesmo com um modelo estável: trocar o nome do modelo sem aceitar a lista JSON válida não resolveria a falha.
- Preços de referência por milhão de tokens: 3.5 Flash-Lite US$ 0,30 de entrada / US$ 2,50 de saída; 3.1 Flash-Lite US$ 0,25 / US$ 1,50. Saída inclui pensamento. O proxy não retorna contagem de uso, portanto tamanho em caracteres não é apresentado como custo ou contagem de tokens.

Fontes oficiais: [modelos e descontinuação](https://ai.google.dev/gemini-api/docs/deprecations), [3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [preços](https://ai.google.dev/gemini-api/docs/pricing), [configuração de pensamento](https://ai.google.dev/gemini-api/docs/generate-content/thinking).

## Validação

`python tests/test_question_highlight_core.py` valida classificação, correspondência literal, cores, referências e preservação de marcas. `python tests/test_question_highlights.py` valida a integração, as chamadas paralelas, falhas independentes, persistência, três cores e conteúdo da resposta escrita. Ambos executam em Chromium; `WEBKIT_EXECUTABLE` habilita WebKit. As suítes não chamam serviços reais. O teste de pixels da animação usa Pillow, além de Playwright.

Também foram feitos ensaios pequenos no proxy real, somente com o texto público dos casos fornecidos. O caso 1–2 foi comparado com os cinco conjuntos de informações da marcação manual: decisão dos governantes, destruição das organizações religiosas, ataque das nações, objetivo de eliminar os adoradores/adoração e Armagedom com o desfecho completo. O caso 3 deve terminar nas perguntas sobre a proteção futura e deixar de fora “Mas antes…”. Os retornos reais também são reaplicados nos testes de DOM. Esses ensaios não garantem acerto em todos os estudos: novos exemplos devem ampliar a base de regressão.

Marcas antigas não são apagadas automaticamente. Para aplicar a nova extração a uma pergunta já salva, gere novamente sua resposta pelo ícone de IA.
