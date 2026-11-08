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

O limite foi reproduzido em uma tabela simulada com `varchar(20)`. Na revisão de concorrência, consultas sem registros confirmaram que o Supabase expõe `xmin` para leitura e filtro. Uma inserção de lista vazia com `ON CONFLICT (usuario_id, semana, tipo)` confirmou a restrição de unicidade; o controle negativo em `conteudo_html` recebeu `42P10`, como esperado. Uma atualização com predicados contraditórios confirmou o filtro condicional sem atingir nenhuma linha. Não houve alteração de esquema, permissões ou anotações reais.

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

O editor salva primeiro no aparelho. O envio lê a versão remota antes de gravar e conserva uma cópia local de divergências conhecidas. Quando outra edição vence uma disputa, a cópia local não é reenviada por cima dela: o editor guarda a comparação por conta e semana e oferece “Usar deste aparelho”, “Usar da nuvem” e “Baixar as duas”. A escolha confere novamente a nuvem; se ela ou a edição local mudou durante a consulta, a comparação é atualizada antes de aceitar a decisão. Uma falha de leitura interrompe a gravação. Conteúdo remoto vazio é tratado como vazio; não provoca a recuperação automática de um texto antigo. A confirmação da nuvem só reconhece a revisão efetivamente salva; uma resposta antiga não confirma uma edição mais recente.

Na Sentinela, a coleta inclui apenas os campos do estudo aberto. Download não recarrega a página nem substitui o campo que mudou durante a consulta. Enviar/baixar apenas ausentes e substituir são operações diferentes. Apagar nesse menu limpa a cópia da nuvem e mantém a local, conforme a descrição da interface. O registro da escolha evita desfazê-la na abertura seguinte.

O editor v1 preservado usa um adaptador no ponto de entrada para a API e as filas atuais. Os arquivos dos snapshots `richtext-v1` e `save-v1` permanecem intactos.

No Programa e na Sentinela, o envio automático pode reler e combinar campos independentes, com no máximo três tentativas por disputa. Quando o mesmo campo muda nos dois lados, mantém a cópia local e a versão vencedora na nuvem. “Enviar / Substituir” continua sendo uma escolha explícita; uma falha de concorrência não repete essa substituição automaticamente.

## Conta e compartilhamento

A identidade é capturada antes de iniciar a consulta e conferida novamente antes de gravar e depois da resposta. Trocar de conta, sair ou fazer um novo login na mesma conta invalida respostas antigas. Gravações de um mesmo documento são serializadas, inclusive quando um novo login ocorre durante uma requisição já enviada.

Falhas de rede, SDK, leitura do armazenamento ou consulta não significam logout nem banco vazio. Cadastro também interrompe a operação se não consegue consultar a disponibilidade do usuário. A interface bloqueia toques duplicados durante confirmação, senha e execução, e só anuncia sucesso após confirmação positiva.

Presença e envio entre usuários usam Realtime, separados dos documentos de backup. Canal, pedido de pareamento, confirmação de entrega e novas tentativas de envio ficam vinculados à sessão e ao destinatário original. Sair ou mudar a conta encerra esse contexto; uma tentativa pendente não passa para um novo destinatário.

## Limites verificados

A gravação agora usa **comparação atômica no PostgreSQL**. Cada leitura recente obtém `xmin`, o identificador da versão da linha. O `UPDATE` exige essa mesma versão, além da conta, semana, tipo e ID. O banco reavalia a condição depois de esperar uma gravação concorrente: se a versão mudou, nenhuma linha é alterada e o cliente recebe `SYNC_CONFLICT`. Não existe tentativa alternativa de gravar sem essa condição.

A primeira gravação usa a restrição única de conta/semana/tipo com `ON CONFLICT DO NOTHING`, sem substituir uma cópia criada por outro aparelho. A exclusão para `{}` passa pela mesma proteção. `xmin` só é usado entre a leitura recente e a gravação; não fica guardado como relógio ou revisão permanente de uma nota offline.

Uma requisição já aceita pelo servidor não pode ser desfeita pelo logout local; sua resposta é descartada pelo cliente. Todos os aparelhos devem receber a versão `ass26-2026.11.08.5`, pois um cliente antigo ainda usa o método anterior de gravação.

Um aparelho anterior à atualização, sem histórico de sincronização, não consegue distinguir uma nota antiga de uma nota ainda não enviada após uma exclusão feita em outro aparelho. Com o histórico novo, notas já sincronizadas e depois removidas da nuvem deixam de ser reenviadas automaticamente pelo Programa.

O login existente consulta a tabela `usuarios`; não usa sessões do Supabase Auth. O isolamento de consultas no cliente não substitui autenticação e políticas RLS no servidor. A restrição de unicidade necessária à criação foi confirmada pelas consultas sem registros; as políticas RLS não foram auditadas com acesso administrativo nesta revisão. A senha do menu é uma confirmação da interface, não uma credencial do banco.

As cópias de recuperação ficam no armazenamento deste aplicativo. Limpar os dados locais também remove essas cópias. A concorrência foi testada em PostgreSQL real isolado e com dois clientes independentes simulados. As verificações no Supabase publicado não acessaram conteúdo de usuários; elas confirmaram apenas as capacidades necessárias à gravação condicional.

## Validação reproduzível

- `node tests/document-api.cjs`: tipos, limites, escopo, compatibilidade, conflitos, identidade, confirmações e dois clientes disputando a mesma versão.
- `python tests/test_postgres_concurrency.py`: PostgreSQL real em container descartável, concorrência coordenada por bloqueios, inserção única, exclusão versus edição, escopo e conteúdo longo.
- `node tests/assembly-sync.cjs`: Programa automático, modos manuais, reabertura, exclusão e mudanças durante requisições.
- `node tests/programme-article-conflicts.cjs`: disputas no Programa/Sentinela, campos independentes, conflitos no mesmo campo, tentativas limitadas e escolhas manuais.
- `node tests/notes-article-sync.cjs`: editor, estudo atual, vazio/ausente, falhas e escolhas manuais.
- `python tests/test_notes_cloud.py`: editor real v1/v2, gravação recusada, nova tentativa, conteúdo vazio e recuperação.
- `node tests/auth-session.cjs` e `python tests/test_auth_session.py`: sessão persistente e respostas atrasadas.
- `python tests/test_assembly_cloud_menu.py`: escolhas e confirmações da interface.
- `python tests/test_peer_session.py`: sessão, pareamento, destinatário e confirmação de entrega.

Os testes de navegador usam Chromium e, com `WEBKIT_EXECUTABLE`, WebKit. O manifesto offline é regenerado e os snapshots v1 são conferidos antes da publicação.

Fontes: [PostgreSQL — colunas de sistema e xmin](https://www.postgresql.org/docs/current/ddl-system-columns.html), [Npgsql — xmin como controle de concorrência](https://www.npgsql.org/efcore/modeling/concurrency.html), [Supabase — upsert](https://supabase.com/docs/reference/javascript/upsert), [PostgreSQL — tipos de caracteres](https://www.postgresql.org/docs/current/datatype-character.html), [Supabase — maybeSingle](https://supabase.com/docs/reference/javascript/maybesingle), [Supabase — update e retorno de registros](https://supabase.com/docs/reference/javascript/update).
