// Builders for the client/server protocol. A command pairs a request with the
// reply it produces; an event is a server push with no request.
//

import { z } from 'zod';
import { RefusalDetailSchema, RefusalReasonSchema } from './refusal.js';

type Shape = z.ZodRawShape;
type Body = Shape | z.ZodObject<Shape>;

type ShapeOf<B extends Body> = B extends z.ZodObject<infer S> ? S : B extends Shape ? B : never;

function asObject(body: Body): z.ZodObject<Shape> {
    return body instanceof z.ZodObject ? body : z.object(body);
}

function stamp<N extends string, B extends Body>(name: N, body: B): EventEnvelope<N, B> {
    return asObject(body).extend({ type: z.literal(name) }) as unknown as EventEnvelope<N, B>;
}

/** Reply variants keyed by `outcome` value, each stamped with the reply's `type`. */
export class Outcomes<V extends Record<string, Body>> {
    constructor(readonly variants: V) {}
}

export function outcomes<V extends Record<string, Body>>(variants: V): Outcomes<V> {
    return new Outcomes(variants);
}

type AnyOutcomes = Outcomes<Record<string, Body>>;

type Stamped<N extends string, B extends Body> = z.ZodObject<
    ShapeOf<B> & { type: z.ZodLiteral<N> }
>;

type OutcomeVariant<N extends string, K extends string, B extends Body> = z.ZodObject<
    ShapeOf<B> & { type: z.ZodLiteral<N>; outcome: z.ZodLiteral<K> }
>;

type OutcomeUnion<N extends string, V extends Record<string, Body>> = {
    [K in keyof V & string]: OutcomeVariant<N, K, V[K]>;
}[keyof V & string];

type RefusedVariant<N extends string> = z.ZodObject<{
    type: z.ZodLiteral<N>;
    outcome: z.ZodLiteral<'refused'>;
    reason: typeof RefusalReasonSchema;
    detail: z.ZodOptional<typeof RefusalDetailSchema>;
}>;

export type EventEnvelope<N extends string, B extends Body> = Stamped<N, B>;

export type ReplyEnvelope<N extends string, B> =
    B extends Outcomes<infer V>
        ? z.ZodDiscriminatedUnion<(OutcomeUnion<N, V> | RefusedVariant<N>)[], 'outcome'>
        : B extends Body
          ? z.ZodDiscriminatedUnion<(OutcomeVariant<N, 'ok', B> | RefusedVariant<N>)[], 'outcome'>
          : never;

/** A named server→client message. */
export type MessageDef<N extends string, S extends z.ZodType> = {
    readonly name: N;
    readonly Schema: S;
};

function buildReplyEnvelope<N extends string, O extends AnyOutcomes>(
    name: N,
    outcomes: O,
): ReplyEnvelope<N, O> {
    const typeLiteral = z.literal(name);
    const members = Object.entries(outcomes.variants).map(([value, variant]) =>
        asObject(variant).extend({ type: typeLiteral, outcome: z.literal(value) }),
    );
    const refused = z.object({
        type: typeLiteral,
        outcome: z.literal('refused'),
        reason: RefusalReasonSchema,
        detail: RefusalDetailSchema.optional(),
    });
    return z.discriminatedUnion('outcome', [...members, refused] as unknown as [
        z.ZodObject<Shape>,
        ...z.ZodObject<Shape>[],
    ]) as unknown as ReplyEnvelope<N, O>;
}

export function defineEvent<N extends string, B extends Body>(
    name: N,
    body: B,
): MessageDef<N, EventEnvelope<N, B>> {
    return { name, Schema: stamp(name, body) };
}

export function defineNamedReply<N extends string, O extends AnyOutcomes>(
    name: N,
    outcomes: O,
): MessageDef<N, ReplyEnvelope<N, O>> {
    return { name, Schema: buildReplyEnvelope(name, outcomes) };
}

type AnyMessageDef = MessageDef<string, z.ZodType>;

export type CommandDef<N extends string, Req extends z.ZodType, R extends AnyMessageDef | null> = {
    readonly name: N;
    readonly Request: Req;
    readonly reply: R;
};

type ReplyInput = AnyOutcomes | AnyMessageDef | null;

type ResolvedReply<N extends string, R extends ReplyInput> = R extends AnyMessageDef
    ? R
    : R extends AnyOutcomes
      ? MessageDef<`${N}Result`, ReplyEnvelope<`${N}Result`, R>>
      : null;

function isMessageDef(x: unknown): x is AnyMessageDef {
    return typeof x === 'object' && x !== null && 'Schema' in x && 'name' in x;
}

export function defineCommand<N extends string, Req extends Body, R extends ReplyInput>(
    name: N,
    def: { request: Req; reply: R },
): CommandDef<N, EventEnvelope<N, Req>, ResolvedReply<N, R>> {
    const Request = stamp(name, def.request);
    let reply: AnyMessageDef | null;
    if (def.reply === null) reply = null;
    else if (isMessageDef(def.reply)) reply = def.reply;
    else reply = defineNamedReply(`${name}Result`, def.reply);
    return { name, Request, reply: reply as ResolvedReply<N, R> };
}
