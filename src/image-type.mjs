// Inspect bytes, never infer an extensionless attachment's type from its name.
export function imageType(bytes){
  if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return {extension:'.png',mime:'image/png'};
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {extension:'.jpg',mime:'image/jpeg'};
  if(['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)))return {extension:'.gif',mime:'image/gif'};
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {extension:'.webp',mime:'image/webp'};
  return undefined;
}
