# Comunicação com o Supabase — Assembleia 2026

Revisão de 8 de novembro de 2026. Escopo: conta, Programa, Anotações, A Sentinela e compartilhamento de texto entre usuários. Os testes usam contas, documentos e respostas sintéticas; não alteram os registros reais do usuário.

## Erro apresentado

A tela informou `value too long for type character varying(20)`. O cliente enviava `ass26:programacao:ca-copgm27`, com **28 caracteres**, e `ass26:sentinela_anotacoes`, com **25**. Os identificadores novos cabem em 20 caracteres sem truncar nem misturar documentos:

| Contexto | `tipo` gravado | Caracteres | `semana` |
| --- | --- | ---: | --- |
| Programa | `ass26:programacao` | 17 | `ca-copgm27` |
| Anotações | `ass26:richtext` | 14 | Semana da nota |
| A Sentinela | `ass26:sentinela` | 15 | Semana do estudo |

Todas as consultas e atualizações incluem conta, semana/programa e tipo. A Sentinela também confere o estudo contido no documento. A leitura mantém compatibilidade com os nomes anteriores da Assembleia quando o registro atual não existe; um registro atual vazio prevalece sobre a cópia antiga. Tipos do sistema Sentinela original não são importados.

A consulta administrativa ao esquema não estava disponível com a chave pública. O limite foi reproduzido em uma tabela simulada com `varchar(20)`; não houve alteração de esquema, permissões ou dados no servidor.

## Operações do Programa

| Escolha | Destino | Comportamento |
| --- | --- | --- |
| Enviar só o que falta | Nuvem | Acrescenta campos ausentes; preserva os existentes, inclusive vazios. |
| Enviar / mesclar | Nuvem | Combina os campos e considera as datas disponíveis nas notas; guarda cópias locais das divergências substituídas. |
| Enviar / substituir | Nuvem | Troca o documento pelo conteúdo local, após confirmação. |
| Baixar só o que falta | Aparelho | Acrescenta campos ausentes sem substituir os locais. |
| Baixar / mesclar | Aparelho | Combina as versões e preserva uma cópia das divergências. Não envia o resultado por causa do download. |
| Baixar / substituir | Aparelho | Restaura o documento remoto, incluindo um documento intencionalmente vazio. Ausência de backup não equivale a backup vazio. |
| Apagar anotações | Nuvem e aparelho | Usa a mesma fila de sincronização. Preserva edições feitas enquanto a operação estava em andamento. |

As notas/respostas e as preferências do Programa são o escopo dos modos de envio e download. A escolha manual é registrada por conta e programa, para que reabrir a página não desfaça a operação. Edições novas voltam ao fluxo automático. A exclusão limpa o conteúdo do documento canônico para `{}`: manter esse registro vazio impede que a compatibilidade de leitura restaure um nome antigo.

## Anotações e A Sentinela

O editor salva primeiro no aparelho. O envio lê a versão remota antes de gravar e conserva uma cópia local de divergências conhecidas. Uma falha de leitura interrompe a gravação. Conteúdo remoto vazio é tratado como vazio; não provoca a recuperação automática de um texto antigo. A confirmação da nuvem só reconhece a revisão efetivamente salva; uma resposta antiga não confirma uma edição mais recente.

Na Sentinela, a coleta inclui apenas os campos do estudo aberto. Download não recarrega a página nem substitui o campo que mudou durante a consulta. Enviar/baixar apenas ausentes e substituir são operações diferentes. Apagar nesse menu limpa a cópia da nuvem e mantém a local, conforme a descrição da interface. O registro da escolha evita desfazê-la na abertura seguinte.

O editor v1 preservado usa um adaptador no ponto de entrada para a API e as filas atuais. Os arquivos dos snapshots `richtext-v1` e `save-v1` permanecem intactos.

## Conta e compartilhamento

A identidade é capturada antes de iniciar a consulta e conferida novamente antes de gravar e depois da resposta. Trocar de conta, sair ou fazer um novo login na mesma conta invalida respostas antigas. Gravações de um mesmo documento são serializadas, inclusive quando um novo login ocorre durante uma requisição já enviada.

Falhas de rede, SDK, leitura do armazenamento ou consulta não significam logout nem banco vazio. Cadastro também interrompe a operação se não consegue consultar a disponibilidade do usuário. A interface bloqueia toques duplicados durante confirmação, senha e execução, e só anuncia sucesso após confirmação positiva.

Presença e envio entre usuários usam Realtime, separados dos documentos de backup. Canal, pedido de pareamento, confirmação de entrega e novas tentativas de envio ficam vinculados à sessão e ao destinatário original. Sair ou mudar a conta encerra esse contexto; uma tentativa pendente não passa para um novo destinatário.

## Limites verificados

A comparação antes da gravação detecta alterações conhecidas, mas **não é uma transação atômica entre aparelhos**. Garantir isso requer uma revisão de documento e uma operação condicional no servidor. Uma requisição já aceita pelo servidor também não pode ser desfeita pelo logout local; sua resposta é descartada pelo cliente.

Um aparelho anterior à atualização, sem histórico de sincronização, não consegue distinguir uma nota antiga de uma nota ainda não enviada após uma exclusão feita em outro aparelho. Com o histórico novo, notas já sincronizadas e depois removidas da nuvem deixam de ser reenviadas automaticamente pelo Programa.

O login existente consulta a tabela `usuarios`; não usa sessões do Supabase Auth. O isolamento de consultas no cliente não substitui autenticação e políticas RLS no servidor. Essas políticas e as restrições reais de unicidade não foram auditadas com acesso administrativo nesta revisão. A senha do menu é uma confirmação da interface, não uma credencial do banco.

As cópias de recuperação ficam no armazenamento deste aplicativo. Limpar os dados locais também remove essas cópias. Os testes não comprovam permissões reais do servidor nem concorrência atômica entre aparelhos.

## Validação reproduzível

- `node tests/document-api.cjs`: tipos, limites, escopo, compatibilidade, conflitos, identidade e confirmações.
- `node tests/assembly-sync.cjs`: Programa automático, modos manuais, reabertura, exclusão e mudanças durante requisições.
- `node tests/notes-article-sync.cjs`: editor, estudo atual, vazio/ausente, falhas e escolhas manuais.
- `python tests/test_notes_cloud.py`: editor real v1/v2, gravação recusada, nova tentativa, conteúdo vazio e recuperação.
- `node tests/auth-session.cjs` e `python tests/test_auth_session.py`: sessão persistente e respostas atrasadas.
- `python tests/test_assembly_cloud_menu.py`: escolhas e confirmações da interface.
- `python tests/test_peer_session.py`: sessão, pareamento, destinatário e confirmação de entrega.

Os testes de navegador usam Chromium e, com `WEBKIT_EXECUTABLE`, WebKit. O manifesto offline é regenerado e os snapshots v1 são conferidos antes da publicação.

Fontes: [PostgreSQL — tipos de caracteres](https://www.postgresql.org/docs/current/datatype-character.html), [Supabase — maybeSingle](https://supabase.com/docs/reference/javascript/maybesingle), [Supabase — update e retorno de registros](https://supabase.com/docs/reference/javascript/update).
