export type Container = Element;
export type Instance = Element;
export type TextInstance = Text;

// export const createInstance = (type: string, props: any): Instance => {
export const createInstance = (type: string): Instance => {
	// TODO 处理props,先不处理
	const element = document.createElement(type);
	// updateFiberProps(element as DOMElement, props);
	return element;
};

export const appendInitialChild = (
	parent: Instance | Container,
	child: Instance
) => {
	parent.appendChild(child);
};

export const createTextInstance = (content: string): TextInstance => {
	return document.createTextNode(content);
};

export const appendChildToContainer = appendInitialChild;
