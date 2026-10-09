// The dashboard data from the server, shared by every module (imported as a live binding)

let data = null;
export { data };
export function setData(d) {
  data = d;
}
