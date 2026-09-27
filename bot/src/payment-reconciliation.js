// Persisted round-robin pages prevent transactions after the first 1000 from
// being permanently skipped. Replaying pages is safe: charge IDs are unique.
export async function readPaymentBatch(api,offset=0,maxPages=10){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>10)throw new Error('invalid_ledger_cursor');
 const transactions=[];
 let nextOffset=offset,complete=false;
 for(let page=0;page<maxPages;page++){
  const result=await api.getStarTransactions({offset:nextOffset,limit:100});
  if(!Array.isArray(result?.transactions)||result.transactions.length>100)throw new Error('invalid_ledger_response');
  transactions.push(...result.transactions);
  nextOffset+=result.transactions.length;
  if(result.transactions.length<100){complete=true;nextOffset=0;break;}
 }
 return {transactions,nextOffset,complete};
}
