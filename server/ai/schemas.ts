import { z } from 'zod'
import { importAlternativeSchema, LIMITS } from '../../shared/schemas/import'

/** Schemas de SAÍDA dos modelos (validados com zod; enviados como json_schema estrito quando suportado). */

/** Uma questão estruturada: ENUNCIADO + PERGUNTAS (cada pergunta com a sua resposta). */
export const structuredBatchSchema = z.object({
  questoes: z.array(
    z.object({
      bloco_id: z.string().describe('id do bloco de origem, copiado da entrada'),
      rotulo: z.string().max(40).nullable(),
      enunciado: z.string().min(3).max(LIMITS.stem),
      perguntas: z
        .array(
          z.object({
            rotulo: z.string().max(10).nullable(),
            texto: z.string().max(LIMITS.prompt).describe('vazio quando o enunciado já é a pergunta (pergunta única)'),
            tipo: z.enum(['objetiva', 'discursiva']),
            resposta_esperada: z.string().max(LIMITS.answer).nullable(),
            pontos_chave: z.array(z.string().max(LIMITS.keyPoint)).max(15),
            alternativas: z.array(importAlternativeSchema).max(8).nullable(),
          }),
        )
        .min(1)
        .max(LIMITS.maxItemsPerQuestion),
      dificuldade: z.enum(['facil', 'media', 'dificil']),
      tem_imagem: z.boolean(),
    }),
  ),
  descartados: z.array(z.object({ bloco_id: z.string(), motivo: z.string() })),
  alertas: z.array(z.string()),
})
export type StructuredBatch = z.infer<typeof structuredBatchSchema>

export const classificationSchema = z.object({
  grupos: z.array(
    z.object({
      area: z.string().max(LIMITS.taxonomy),
      disciplina: z.string().max(LIMITS.taxonomy),
      assunto: z.string().max(LIMITS.taxonomy),
      descricao: z.string().max(400),
      questoes: z.array(z.object({ id: z.string(), resumo: z.string().max(240) })),
    }),
  ),
})
export type Classification = z.infer<typeof classificationSchema>

/** Nó `link`: pares questão × resposta do gabarito (só ids — o texto é sempre o do gabarito). */
export const linkSchema = z.object({
  pares: z.array(z.object({ questao_id: z.string().max(20), resposta_id: z.string().max(20) })).max(100),
})

export const distractorsSchema = z.object({
  itens: z.array(
    z.object({
      id: z.string(),
      correta: z.string().max(LIMITS.alternative),
      incorretas: z.array(z.object({ texto: z.string().max(LIMITS.alternative), explicacao: z.string().max(600) })).length(4),
    }),
  ),
})
export type Distractors = z.infer<typeof distractorsSchema>

/** Objetiva → discursiva: resposta escrita (sem citar letras) + pontos de acerto, por pergunta. */
export const writtenAnswersSchema = z.object({
  itens: z.array(
    z.object({
      id: z.string(),
      resposta_esperada: z.string().min(10).max(2000),
      pontos_chave: z.array(z.string().min(2).max(LIMITS.keyPoint)).min(3).max(6),
    }),
  ),
})
export type WrittenAnswers = z.infer<typeof writtenAnswersSchema>

export const explanationSchema = z.object({
  dica: z.string().max(400),
  por_alternativa: z.array(z.object({ id: z.string(), veredito: z.enum(['correta', 'incorreta']), porque: z.string().max(800) })),
  resumo: z.string().max(1500),
})
export type Explanation = z.infer<typeof explanationSchema>

export const gradeSchema = z.object({
  pontos: z.array(z.object({ ponto: z.string(), atendido: z.boolean() })),
  nota: z.number().min(0).max(1),
  feedback: z.string().max(600),
})

export const guardSchema = z.object({ suspeito: z.boolean(), motivos: z.array(z.string()).max(10) })

/** Visão: transcrição de cada recorte de imagem enviado (um item por `imagem_id`). */
export const visionSchema = z.object({
  imagens: z
    .array(
      z.object({
        id: z.string().max(20).describe('imagem_id copiado da entrada'),
        tipo: z.enum(['texto', 'pop_q', 'tabela', 'figura', 'decorativa']),
        transcricao: z.string().max(8000),
      }),
    )
    .max(12),
  alertas: z.array(z.string().max(300)).max(10),
})
export type VisionBatch = z.infer<typeof visionSchema>
