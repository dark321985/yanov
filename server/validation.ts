import { z } from 'zod';
import { isDate } from './dates.js';

export const id=z.uuid();
export const day=z.string().refine(isDate,'Укажите корректную дату.');
export const money=z.number().int().min(1).max(1_000_000_000_000);
const text=(max: number)=>z.string().trim().max(max).default('');
export const clientInput=z.object({name:z.string().trim().min(1).max(200),phone:text(80),email:z.union([z.literal(''),z.email()]).default(''),contact:text(200),notes:text(4000)});
export const warehouseInput=z.object({number:z.string().trim().min(1).max(80),area:z.number().positive().max(1_000_000).nullable().default(null),address:text(500),notes:text(4000),availability:z.enum(['available','maintenance']).default('available')});
export const leaseInput=z.object({clientId:id,warehouseId:id,startDate:day,monthlyRateMinor:money,notes:text(4000)});
export const paymentInput=z.object({leaseId:id,receivedOn:day,amountMinor:money,chargeIds:z.array(id).min(1).max(120).refine((ids)=>new Set(ids).size===ids.length,'Периоды не должны повторяться.'),method:z.enum(['cash','transfer','other']),notes:text(4000)});
export const version=z.number().int().positive();
export const settingsInput=z.object({businessName:z.string().trim().min(1).max(120),timezone:z.string().refine((value)=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}),reminderDays:z.number().int().min(0).max(90),reminderTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),telegramEnabled:z.boolean(),telegramChatId:z.string().trim().max(100).refine((v)=>v===''||/^-?\d+$/.test(v)),version});
export const listQuery=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25),search:z.string().trim().max(200).default(''),archived:z.enum(['true','false']).default('false'),occupancy:z.enum(['all','occupied','free']).default('all'),status:z.enum(['all','active','scheduled','ended','open','paid','overdue']).default('all'),clientId:id.optional(),warehouseId:id.optional(),leaseId:id.optional(),from:day.optional(),to:day.optional(),debt:z.enum(['true','false']).default('false'),includeReversed:z.enum(['true','false']).default('false')});
export const paymentListQuery=listQuery.extend({method:z.enum(['all','cash','transfer','other']).default('all')});
export function validRange(from: string|undefined,to: string|undefined) {
  if(from&&to&&(from>to||Date.parse(to)-Date.parse(from)>3660*86400000))throw new z.ZodError([{code:'custom',path:['to'],message:'Выберите период не более 10 лет с окончанием после начала.'}]);
}
