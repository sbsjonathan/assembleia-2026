# Agentes de recapitulação, objetivo, subtítulos e pontos altos

A revisão `ass26-2026.11.09.3` mantém os quatro agentes e suas listas de modelos. As alterações concentram-se na fonte recebida, na finalidade de cada resposta e na validação antes de exibi-la ou salvá-la. O agente de perguntas, o Tutor e o resumidor dos campos de anotação não são alterados.

## Fonte e resposta

- **Recapitulação:** combina o título da recapitulação com o item perguntado e consulta os parágrafos numerados do artigo. Produz uma resposta direta e citações literais que a sustentam. Cada trecho precisa ocorrer de forma inequívoca no parágrafo indicado; não há aproximação por palavras parecidas ou âncoras. Os links para os parágrafos também funcionam depois de restaurar uma resposta salva. Marcas manuais e marcas dos demais agentes são preservadas.
- **Objetivo:** relaciona o objetivo declarado aos argumentos do artigo. Mantém as abas de visão geral e aplicação prática; as aplicações devem derivar das orientações efetivamente presentes, sem preencher a resposta com conselhos genéricos.
- **Subtítulos:** consulta somente a seção indicada, mesmo quando os elementos estão dentro de contêineres diferentes. No título do artigo, a fonte é a introdução antes do primeiro subtítulo. O destaque comunica a conclusão central e a visão explica seus fundamentos, evitando repetir o mesmo conteúdo.
- **Pontos altos:** reúne as anotações originais dos discursos, identificando título e período. A chamada do programa continua abrangendo a assembleia completa, Manhã e Tarde. O resumo deve unir ideias repetidas e preservar lições específicas, sem inventar experiências pessoais, saudações ou aplicações. O nome da conta não é enviado. Notas muito longas compartilham um orçamento de 16 mil caracteres: trechos iniciais e finais são identificados como parciais, e o resultado informa quando foi baseado nesses recortes.

Nos agentes do artigo, anotações pessoais, respostas de IA, controles e diálogos são excluídos da fonte. Referências explícitas a números de parágrafos em objetivo e subtítulos são verificadas contra os parágrafos disponíveis. Isso valida a referência, mas não substitui a avaliação semântica da resposta.

## Persistência e falhas

Respostas com formato inválido passam pela próxima alternativa já configurada. Pedidos repetidos simultaneamente compartilham a mesma execução. Uma falha mantém a resposta anterior; estados de carregamento e erros não são salvos como conteúdo. Retornos de uma análise cuja fonte foi alterada ou apagada não podem sobrescrever o estado atual. O valor salvo também é conferido antes da gravação, para preservar restaurações da nuvem que ainda não foram exibidas porque um controle estava focado. A recapitulação protege tanto a resposta quanto os parágrafos que receberiam suas marcas.

Objetivo e subtítulos usam cache identificado pelo conteúdo e pelo estudo, em vez de apenas pelo comprimento do texto. A versão do cache foi incrementada e suas chaves foram mantidas para compatibilidade com apagar e sincronizar. Respostas antigas não são apagadas automaticamente: gere novamente para aplicar as novas instruções.

Recapitulação, objetivo e subtítulos recusam uma entrada acima do orçamento antes de enviar a requisição, em vez de cortar silenciosamente parágrafos ou instruções. Pontos altos usa recortes explicitamente identificados, pois anotações pessoais podem crescer sem limite.

## Verificação

As suítes usam apenas fontes e notas de teste, sem chamar Gemini ou Supabase:

```sh
python tests/test_recap_agent.py
python tests/test_obj_sub_agents.py
python tests/test_program_highpoints.py
python tests/test_article_clear.py
python tests/test_program_summary.py
```

`WEBKIT_EXECUTABLE` permite executar também em WebKit. Os testes cobrem fonte, referências, formato, alternativas, cache, cliques repetidos, preservação das respostas e conflitos com edição, exclusão e sincronização. O resumidor regular continua com o limiar de 50 caracteres.

Uma comparação pequena com o proxy real usa um artigo público e notas sintéticas, antes e depois da revisão. As respostas gravadas são reaplicadas no navegador para verificar sua aceitação. Esse ensaio ajuda a avaliar utilidade e fidelidade, mas não garante acerto em todos os artigos. O proxy não fornece contagem de tokens; comprimento de entrada não deve ser apresentado como custo medido.
