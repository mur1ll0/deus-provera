import type { Alternative, Difficulty, Question, QuestionGroup, QuestionItem } from '@shared/domain'

/**
 * Questões FICTÍCIAS do protótipo no formato Questão = Enunciado + Perguntas.
 * O usuário atual é "u-me"; outros donos simulam a "comunidade".
 */

export const GROUPS: QuestionGroup[] = [
  { id: 'g-pop', ownerId: 'u-me', areaId: 'a-med', disciplineId: 'd-gin', topic: 'Prolapso genital', description: 'POP-Q, Baden-Walker e tratamento cirúrgico — Profª Mayra' },
  { id: 'g-iu', ownerId: 'u-me', areaId: 'a-med', disciplineId: 'd-gin', topic: 'Incontinência urinária', description: 'IUE, bexiga hiperativa, slings' },
  { id: 'g-hpv', ownerId: 'u-me', areaId: 'a-med', disciplineId: 'd-gin', topic: 'HPV e lesões precursoras', description: 'Rastreamento, NIC e condutas (III unidade)' },
  { id: 'g-endo', ownerId: 'u-2', areaId: 'a-med', disciplineId: 'd-gin', topic: 'Endometriose', description: 'Diagnóstico por imagem e tratamento' },
  { id: 'g-clim', ownerId: 'u-3', areaId: 'a-med', disciplineId: 'd-gin', topic: 'Climatério', description: 'Terapia hormonal e contraindicações' },
  { id: 'g-card', ownerId: 'u-4', areaId: 'a-med', disciplineId: 'd-card', topic: 'ECG e semiologia', description: 'Distúrbios eletrolíticos e sopros' },
  { id: 'g-int', ownerId: 'u-me', areaId: 'a-mat', disciplineId: 'd-calc', topic: 'Integrais', description: 'Integrais imediatas e definidas' },
  { id: 'g-der', ownerId: 'u-5', areaId: 'a-mat', disciplineId: 'd-calc', topic: 'Derivadas', description: 'Regras de derivação' },
  { id: 'g-psi', ownerId: 'u-6', areaId: 'a-psi', disciplineId: 'd-dev', topic: 'Teorias do desenvolvimento', description: 'Piaget, Vygotsky e Erikson' },
]
const G = Object.fromEntries(GROUPS.map((g) => [g.id, g])) as Record<string, QuestionGroup>

let seq = 0
const alt = (text: string, correct = false, explanation?: string, source: Alternative['source'] = 'usuario'): Alternative => ({
  id: `alt-${++seq}`,
  text,
  correct,
  explanation,
  source,
})
const iaAlt = (text: string, correct = false, explanation?: string) => alt(text, correct, explanation, 'ia')

/** Pergunta objetiva (alternativas do próprio material). */
const objetiva = (prompt: string, alternatives: Alternative[], label?: string, comment?: string): QuestionItem => ({
  id: `it-${++seq}`,
  label,
  prompt,
  type: 'objetiva',
  alternatives,
  expectedAnswer: comment,
})

/** Pergunta discursiva (resposta esperada + pontos-chave; alternativas opcionais geradas por IA). */
const discursiva = (prompt: string, expectedAnswer: string, keyPoints: string[], label?: string, alternatives?: Alternative[]): QuestionItem => ({
  id: `it-${++seq}`,
  label,
  prompt,
  type: 'discursiva',
  expectedAnswer,
  keyPoints,
  alternatives,
})

const q = (id: string, group: string, difficulty: Difficulty, stem: string, items: QuestionItem[], extra: Partial<Question> = {}): Question => {
  const g = G[group]
  return {
    id,
    ownerId: g.ownerId,
    groupId: g.id,
    areaId: g.areaId,
    disciplineId: g.disciplineId,
    topic: g.topic,
    stem,
    items,
    difficulty,
    visibility: 'publica',
    origin: 'manual',
    createdAt: '2026-10-20T12:00:00Z',
    ...extra,
  }
}

export const QUESTIONS: Question[] = [
  // ---------------- HPV (exemplo do III UNIDADE.pdf, QUESTÃO 8: enunciado + 2 perguntas) ----------------
  q(
    'q-hpv-8',
    'g-hpv',
    'dificil',
    'Joana tem 45 anos e menstrua regularmente. Ela já teve 2 filhos de parto vaginal com João, com quem foi casada por 15 anos. Agora veio para exame de rotina. No momento, ela tem uma namorada de 35 anos com quem mora há 4 anos. Joana relata que quando era casada, teve um quadro de verrugas genitais que logo desapareceram. Também foi submetida à cauterização do colo uterino pois teve uma "ferimento pequeno", segundo o seu médico na época. O exame físico atual revelou colo com área iodo-positivo de 3 às 5 horas. A colpocitologia mostrou ASCUS. Responda:',
    [
      discursiva(
        'A paciente apresenta um quadro clínico de patologia causada pelo HPV e no momento não tem atividade sexual com penetração vaginal peniana. Diante desta certeza, há necessidade de solicitar algum outro exame? Justifique.',
        'Sim. Deve-se solicitar o teste de DNA-HPV de alto risco: aos 45 anos o rastreamento busca persistência viral, e a transmissão do HPV não depende de penetração (contato pele/mucosa, inclusive entre mulheres). Com ASCUS, o teste de HPV orienta a conduta (positivo → colposcopia).',
        ['Solicitar teste de DNA-HPV de alto risco', 'Transmissão não depende de penetração peniana', 'Aos 45 anos o objetivo é detectar persistência', 'HPV positivo com ASCUS → colposcopia'],
        'a',
        [
          iaAlt('Sim: solicitar DNA-HPV de alto risco, pois a transmissão independe de penetração e é preciso avaliar persistência', true, 'Resume a resposta esperada.'),
          iaAlt('Não: sem penetração vaginal peniana não há risco de reinfecção pelo HPV', false, 'O HPV é transmitido por contato pele a pele/mucosa, inclusive entre mulheres.'),
          iaAlt('Não: ASCUS em mulher de 45 anos dispensa qualquer investigação adicional', false, 'ASCUS exige complementação (DNA-HPV ou repetição/colposcopia).'),
          iaAlt('Sim: solicitar apenas sorologias para sífilis e HIV, sem teste de HPV', false, 'Sorologias não substituem a avaliação de persistência do HPV.'),
          iaAlt('Sim: indicar conização diagnóstica imediata pelo antecedente de verrugas', false, 'Conização sem lesão de alto grau confirmada é sobretratamento.'),
        ],
      ),
      discursiva(
        'A parceira dela insistiu que ela fizesse uma colposcopia, quando viram o resultado da citologia. Elas já trouxeram o resultado que evidenciou epitélio acetobranco denso com borda bem delimitada de 3 às 5 horas. Não foi realizado biopsia. Elas perguntam: o que significa este resultado? O que deve ser feito agora?',
        'Epitélio acetobranco denso com borda bem delimitada é achado colposcópico de grau maior, sugestivo de lesão intraepitelial de alto grau (NIC II/III). A conduta é a biópsia dirigida da área (ou "ver e tratar" com exérese da zona de transformação, se critérios presentes) para confirmação histológica antes do tratamento.',
        ['Achado colposcópico de grau maior', 'Sugere lesão de alto grau (NIC II/III)', 'Biópsia dirigida da área', 'Ver e tratar (EZT) quando indicado'],
        'b',
        [
          iaAlt('Achado de grau menor, compatível com metaplasia: repetir citologia em 3 anos', false, 'Acetobranco denso com borda nítida é grau maior.'),
          iaAlt('Achado de grau maior sugestivo de HSIL: fazer biópsia dirigida (ou ver e tratar) antes de tratar', true, 'Resume a resposta esperada.'),
          iaAlt('Achado indica carcinoma invasor: encaminhar direto para histerectomia radical', false, 'Não há sinais de invasão; precisa de histologia.'),
          iaAlt('Achado inespecífico de inflamação: tratar corrimento e repetir colposcopia em 1 ano', false, 'Subestima um achado de grau maior.'),
          iaAlt('Achado normal da zona de transformação: retornar ao rastreamento de rotina', false, 'Acetobranco denso não é achado normal.'),
        ],
      ),
    ],
    { sourceLabel: 'QUESTÃO 8', origin: 'pdf_ia' },
  ),
  q(
    'q-hpv-2',
    'g-hpv',
    'dificil',
    'Mulher de 45 anos, G7P6A1, tabagista, com citologia de alto grau. Colposcopia: mosaico grosseiro às 12h. Biópsia: NIC III (carcinoma in situ).',
    [
      objetiva('Qual a melhor conduta?', [
        alt('Conização (método excisional diagnóstico e terapêutico)', true, 'Permite avaliar margens e excluir microinvasão antes de qualquer cirurgia definitiva.'),
        alt('Histerectomia total abdominal imediata', false, 'Sem conização prévia, pode tratar inadequadamente um carcinoma invasor oculto.'),
        alt('Seguimento citológico semestral', false, 'NIC III exige tratamento.'),
        alt('Radioterapia pélvica', false, 'Tratamento de doença invasora.'),
        alt('Cauterização química', false, 'Inadequada para lesão de alto grau.'),
      ], 'a'),
      discursiva(
        'Se a paciente fosse HIV positiva, a conduta mudaria? Justifique.',
        'O tratamento (excisional) não muda, mas o seguimento é mais rigoroso: a imunossupressão aumenta persistência, recorrência e progressão das lesões. Citologia e colposcopia a cada 6 meses por 2 anos e depois anualmente por toda a vida.',
        ['Tratamento excisional mantido', 'Imunossupressão aumenta recorrência', 'Seguimento semestral por 2 anos', 'Depois anual por toda a vida'],
        'b',
      ),
    ],
    { sourceLabel: 'QUESTÃO 2', origin: 'pdf_ia' },
  ),
  q('q-hpv-1', 'g-hpv', 'media', 'Mulher de 22 anos, assintomática, com citologia sugestiva de lesão intraepitelial de baixo grau (LSIL). Segundo as diretrizes brasileiras, qual a conduta?', [
    objetiva('', [
      alt('Repetir a citologia em 3 anos', true, 'Até 24 anos, LSIL tem alta taxa de regressão; repetir em 3 anos e reiniciar rastreamento aos 25.'),
      alt('Colposcopia imediata', false, 'Indicada se nova citologia mostrar alteração mais grave.'),
      alt('Exérese da zona de transformação', false, 'Tratamento excessivo para LSIL nessa idade.'),
      alt('Conização a frio', false, 'Reservada a lesões de alto grau com indicações específicas.'),
      alt('Repetir a citologia em 6 meses', false, 'Conduta para ≥ 25 anos.'),
    ]),
  ]),

  // ---------------- Prolapso genital ----------------
  q('q-pop-1', 'g-pop', 'facil', 'Na classificação POP-Q, qual estrutura é o ponto de referência fixo (zero)?', [
    objetiva('', [
      alt('Carúncula himenal (hímen)', true, 'O hímen é o plano de referência 0: pontos acima são negativos e abaixo, positivos.'),
      alt('Colo uterino', false, 'O colo é o ponto C, medido em relação ao hímen.'),
      alt('Fúrcula vaginal', false, 'A fúrcula delimita o hiato genital (HG), não é o ponto zero.'),
      alt('Espinha isquiática', false, 'Referência usada em outras técnicas (ex.: estação fetal), não no POP-Q.'),
      alt('Corpo perineal', false, 'O corpo perineal (CP) é uma medida, não a referência.'),
    ]),
  ]),
  q(
    'q-pop-2',
    'g-pop',
    'media',
    'Observe o esquema da classificação POP-Q abaixo.\n[Imagem: Aa +3, Ba +5, C +6, HG 5, CP 2, CVT 6, Ap +3, Bp +3]\nPara ele:',
    [
      discursiva('dê o diagnóstico (estádio);', 'Prolapso de paredes anterior, posterior e apical — estádio IV (ponto mais distal ≥ CVT − 2).', ['Estádio IV', 'Ponto mais distal ≥ CVT − 2', 'Compartimentos anterior, apical e posterior'], 'a', [
        iaAlt('Estádio IV: ponto mais distal (+6) ≥ CVT − 2', true),
        iaAlt('Estádio III: ponto mais distal > +1', false, 'Estádio III exige ponto mais distal < CVT − 2.'),
        iaAlt('Estádio II: ponto mais distal entre −1 e +1', false, 'Os pontos estão bem além de +1.'),
        iaAlt('Estádio I: ponto mais distal < −1', false, 'Os pontos são positivos.'),
        iaAlt('Estádio 0: sem prolapso', false, 'Há prolapso evidente.'),
      ]),
      discursiva('sugira o tratamento cirúrgico (se houver);', 'Correção cirúrgica: colporrafia anterior e posterior + correção apical (histerectomia vaginal com fixação da cúpula ou colpocleise se idosa sem atividade sexual vaginal).', ['Colporrafia anterior e posterior', 'Correção do compartimento apical', 'Colpocleise se sem atividade sexual'], 'b'),
      discursiva('faça a correspondência (se possível) com a classificação de Baden e Walker.', 'Grau 4 de Baden-Walker (eversão total).', ['Grau 4 de Baden-Walker'], 'c', [
        iaAlt('Grau 4 (eversão total)', true),
        iaAlt('Grau 3 (além do hímen)', false, 'Eversão completa corresponde ao grau 4.'),
        iaAlt('Grau 2 (até o hímen)', false, 'O prolapso ultrapassa o hímen.'),
        iaAlt('Grau 1 (até metade da vagina)', false, 'Subestima o prolapso.'),
        iaAlt('Não há correspondência possível', false, 'Há correspondência aproximada.'),
      ]),
    ],
    { hasImage: true, imageDescription: 'Esquema POP-Q: Aa +3, Ba +5, C +6, HG 5, CP 2, CVT 6, Ap +3, Bp +3', sourceLabel: 'QUESTÃO 2', origin: 'pdf_ia' },
  ),
  q('q-pop-3', 'g-pop', 'media', 'Mulher de 80 anos, viúva, sem atividade sexual, com prolapso uterino volumoso (estádio IV) e episódios de retenção urinária.', [
    discursiva('Qual cirurgia obliterativa pode ser indicada e por quê?', 'Colpocleise: indicada para idosas com prolapso volumoso que não desejam atividade sexual vaginal — menor tempo cirúrgico, baixa morbidade e alta taxa de sucesso.', ['Colpocleise', 'Sem desejo de atividade sexual vaginal', 'Menor morbidade / tempo cirúrgico'], 'a'),
    discursiva('Por que é importante investigar incontinência urinária oculta antes da cirurgia?', 'O prolapso volumoso pode acotovelar a uretra e mascarar a IUE, que só aparece após a correção. A redução do prolapso no exame ou a urodinâmica identificam a IUE oculta e permitem associar sling de uretra média.', ['Acotovelamento da uretra', 'Mascara a IUE', 'Redução do prolapso / urodinâmica', 'Associar sling'], 'b'),
  ]),

  // ---------------- Incontinência urinária ----------------
  q('q-iu-1', 'g-iu', 'media', 'Qual é o tratamento cirúrgico mais utilizado atualmente para incontinência urinária de esforço por hipermobilidade uretral?', [
    objetiva('', [
      alt('Sling de uretra média (TVT/TOT)', true, 'Menor morbidade, técnica sem tensão sob a uretra média, alta taxa de cura.'),
      alt('Colporrafia anterior (Kelly-Kennedy)', false, 'Corrige cistocele, mas tem baixa eficácia para IUE.'),
      alt('Colpocleise', false, 'Cirurgia obliterativa para prolapso, não para IUE.'),
      alt('Histerectomia vaginal', false, 'Não trata o mecanismo da IUE.'),
      alt('Oxibutinina', false, 'Antimuscarínico para bexiga hiperativa, não é cirurgia.'),
    ]),
  ]),
  q('q-iu-2', 'g-iu', 'facil', 'Qual fármaco é um agonista β3-adrenérgico usado na bexiga hiperativa?', [
    objetiva('', [
      alt('Mirabegrona', true, 'Relaxa o detrusor via receptor β3, com menos efeitos anticolinérgicos.'),
      alt('Oxibutinina', false, 'É antimuscarínico.'),
      alt('Duloxetina', false, 'Usada off-label na IUE.'),
      alt('Tansulosina', false, 'Bloqueador α1.'),
      alt('Imipramina', false, 'Tricíclico com efeito anticolinérgico.'),
    ]),
  ]),
  q('q-iu-3', 'g-iu', 'media', 'Diferencie o sling clássico do TVT quanto ao local de posicionamento da faixa e ao material utilizado.', [
    discursiva('', 'Sling clássico: faixa sob a junção uretrovesical, geralmente com fáscia autóloga do reto abdominal; mais invasivo, reservado para casos graves/recidivados. TVT: sling de uretra média com faixa de polipropileno, sem tensão.', ['Junção uretrovesical (clássico)', 'Fáscia autóloga', 'Uretra média (TVT)', 'Polipropileno sem tensão']),
  ]),

  // ---------------- Comunidade ----------------
  q('q-endo-1', 'g-endo', 'media', 'Qual exame de imagem é preferencial para mapeamento de endometriose profunda quando feito por examinador experiente?', [
    objetiva('', [
      alt('Ultrassonografia transvaginal com preparo intestinal', true, 'Alta acurácia para nódulos retrocervicais, uterossacros, reto e bexiga.'),
      alt('Tomografia de abdome', false, 'Baixa resolução para lesões pélvicas pequenas.'),
      alt('Dosagem de CA-125', false, 'Não é exame de imagem.'),
      alt('Histerossalpingografia', false, 'Avalia permeabilidade tubária.'),
      alt('Cintilografia óssea', false, 'Sem indicação.'),
    ]),
  ]),
  q('q-endo-2', 'g-endo', 'media', 'Paciente de 26 anos com cólica menstrual progressiva há 3 anos, dispareunia superficial e tia com endometriose. Exame ginecológico normal.', [
    discursiva('Que exames você solicitaria?', 'USG transvaginal com preparo intestinal (ou RM com protocolo para endometriose) por examinador experiente; CA-125 tem baixa sensibilidade e não confirma nem exclui.', ['USG TV com preparo intestinal ou RM', 'Examinador experiente', 'CA-125 não confirma/exclui'], 'a'),
    discursiva('Caso os exames sejam normais, qual sua conduta?', 'Exames normais não excluem endometriose superficial. Tratamento clínico empírico (ACO contínuo ou progestágeno isolado + AINE nas crises), reavaliar em 3–6 meses; videolaparoscopia se falha.', ['Não excluem', 'Tratamento clínico empírico', 'Videolaparoscopia se falha'], 'b'),
  ]),
  q('q-clim-1', 'g-clim', 'facil', 'Qual das condições abaixo é contraindicação à terapia hormonal da menopausa?', [
    objetiva('', [
      alt('Câncer de mama', true, 'Neoplasia hormônio-dependente é contraindicação clássica.'),
      alt('Hipertensão arterial controlada', false, 'Não contraindica; prefere-se via transdérmica.'),
      alt('Osteopenia', false, 'Pode até ser benefício adicional.'),
      alt('Fogachos intensos', false, 'É a principal indicação.'),
      alt('Idade de 52 anos', false, 'Dentro da janela de oportunidade.'),
    ]),
  ]),
  q('q-card-1', 'g-card', 'facil', 'Qual achado eletrocardiográfico é mais característico de hipercalemia?', [
    objetiva('', [alt('Onda T apiculada', true, 'Primeiro sinal típico.'), alt('Onda U proeminente', false, 'Hipocalemia.'), alt('Onda delta', false, 'WPW.'), alt('QT longo isolado'), alt('Supra de ST em parede inferior', false, 'IAM inferior.')]),
  ]),
  q('q-card-2', 'g-card', 'media', 'Sopro diastólico em ruflar, com reforço pré-sistólico, audível no foco mitral sugere:', [
    objetiva('', [alt('Estenose mitral', true), alt('Insuficiência aórtica'), alt('Estenose aórtica'), alt('Insuficiência mitral'), alt('Comunicação interventricular')]),
  ]),
  q('q-int-1', 'g-int', 'facil', 'Calcule as integrais:', [
    objetiva('∫ 2x dx', [alt('x² + C', true, 'd(x²)/dx = 2x.'), alt('2x² + C'), alt('x + C'), alt('2 + C'), alt('x²/2 + C')], 'a'),
    objetiva('∫₀¹ x² dx', [alt('1/3', true, '[x³/3] de 0 a 1.'), alt('1/2'), alt('1'), alt('2/3'), alt('3')], 'b'),
  ]),
  q('q-int-2', 'g-int', 'media', 'Enuncie a 2ª parte do Teorema Fundamental do Cálculo e dê um exemplo.', [
    discursiva('', 'Se f é contínua em [a, b] e F é primitiva de f, então ∫ₐᵇ f(x) dx = F(b) − F(a). Exemplo: ∫₀² 3x² dx = [x³]₀² = 8.', ['f contínua em [a, b]', 'F primitiva de f', 'F(b) − F(a)', 'Exemplo correto']),
  ]),
  q('q-der-1', 'g-der', 'facil', 'A derivada de sen(x) é:', [objetiva('', [alt('cos(x)', true), alt('−cos(x)'), alt('sen(x)'), alt('−sen(x)'), alt('tg(x)')])]),
  q('q-psi-1', 'g-psi', 'facil', 'Responda sobre as teorias do desenvolvimento:', [
    objetiva('Segundo Piaget, a conservação de quantidades surge em qual estágio?', [alt('Operatório concreto', true), alt('Sensório-motor'), alt('Pré-operatório'), alt('Operatório formal'), alt('Genital')], 'a'),
    objetiva('Qual conceito de Vygotsky descreve a distância entre o desenvolvimento real e o potencial?', [alt('Zona de desenvolvimento proximal', true), alt('Assimilação'), alt('Equilibração'), alt('Esquema'), alt('Andaime (scaffolding)')], 'b'),
    objetiva('Na teoria de Erikson, qual é o conflito central da adolescência?', [alt('Identidade × confusão de papéis', true), alt('Intimidade × isolamento'), alt('Confiança × desconfiança'), alt('Generatividade × estagnação'), alt('Iniciativa × culpa')], 'c'),
  ]),
]
